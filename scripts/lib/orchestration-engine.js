/**
 * scripts/lib/orchestration-engine.js
 *
 * Real-time Multi-Agent Orchestration Engine for FXMind.
 * Coordinates tasks decomposed by Claude or initiated via the Web Panel,
 * validates DAG dependencies, enforces concurrency & provider rules,
 * supports confirmation mode, and persists real-time state snapshots.
 */
"use strict";

const crypto = require("crypto");
const { EventEmitter } = require("events");
const fs = require("fs");
const path = require("path");
const { readOrchestrationConfig } = require("./panel-orchestration");
const runner = require("./orchestration-runner");
const threads = require("./panel-threads");

const emitter = new EventEmitter();
emitter.setMaxListeners(100);

// In-memory active orchestrations: Map<id, OrchestrationSession>
const sessions = new Map();
// Active AbortControllers per session (kept out of JSON serialization): Map<id, AbortController>
const controllers = new Map();

const READONLY_SUBTASK_TYPES = new Set(["explore", "review", "query"]);

function stateFilePath(projectRoot) {
  if (!projectRoot) return null;
  return path.join(path.resolve(projectRoot), ".fxmind", "state", "orchestrations.json");
}

function persistSessions(projectRoot) {
  const filePath = stateFilePath(projectRoot);
  if (!filePath) return;
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const list = Array.from(sessions.values()).map((s) => ({
      id: s.id,
      task: s.task,
      status: s.status,
      mode: s.mode,
      strategy: s.strategy,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      completedAt: s.completedAt || null,
      subtasks: s.subtasks,
      projectRoot: s.projectRoot,
      summary: s.summary || null,
    }));
    fs.writeFileSync(filePath, JSON.stringify(list.slice(-30), null, 2), "utf8");
  } catch {
    // Non-fatal persistence
  }
}

function loadPersistedSessions(projectRoot) {
  const filePath = stateFilePath(projectRoot);
  if (!filePath || !fs.existsSync(filePath)) return;
  try {
    const list = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (Array.isArray(list)) {
      for (const item of list) {
        if (item && item.id && !sessions.has(item.id)) {
          sessions.set(item.id, item);
        }
      }
    }
  } catch {
    // Ignore corrupt state
  }
}

/**
 * Validates subtask list for duplicate IDs, missing dependencies, and DAG cycles.
 */
function validatePlanSubtasks(normalizedSubtasks) {
  const byId = new Map();
  for (const st of normalizedSubtasks) {
    if (byId.has(st.id)) {
      return { ok: false, error: `Duplicate subtask id: "${st.id}"` };
    }
    byId.set(st.id, st);
  }

  for (const st of normalizedSubtasks) {
    for (const depId of st.dependsOn) {
      if (depId === st.id) {
        return { ok: false, error: `Subtask "${st.id}" cannot depend on itself` };
      }
      if (!byId.has(depId)) {
        return { ok: false, error: `Subtask "${st.id}" depends on unknown subtask "${depId}"` };
      }
    }
  }

  // 3-color DFS cycle detection: 0 = unvisited, 1 = visiting, 2 = visited
  const state = new Map();
  function dfs(id) {
    const current = state.get(id) || 0;
    if (current === 1) return id;
    if (current === 2) return null;
    state.set(id, 1);
    const node = byId.get(id);
    for (const depId of node.dependsOn) {
      const cycleNode = dfs(depId);
      if (cycleNode) return cycleNode;
    }
    state.set(id, 2);
    return null;
  }

  for (const st of normalizedSubtasks) {
    const cycleAt = dfs(st.id);
    if (cycleAt) {
      return { ok: false, error: `Dependency cycle detected involving subtask "${cycleAt}"` };
    }
  }

  return { ok: true };
}

/**
 * Resolves which provider, model and effort to use for a given subtask
 * based on configuration routing rules and allowedProviders policy.
 */
function resolveSubtaskRouting(subtask, config) {
  const routing = config.routing || {};
  const rules = Array.isArray(routing.rules) ? routing.rules : [];
  const allowed = Array.isArray(config.allowedProviders) && config.allowedProviders.length > 0
    ? config.allowedProviders.map((p) => String(p).trim()).filter(Boolean)
    : null;

  const isAllowed = (providerId) => !allowed || !providerId || allowed.includes(providerId);

  let provider = null;
  let model = subtask.model || routing.defaultModel || null;
  let effort = subtask.effort || routing.defaultEffort || "medium";

  if (subtask.provider) {
    const explicitProvider = String(subtask.provider).trim();
    if (!isAllowed(explicitProvider)) {
      return {
        error: `Provider "${explicitProvider}" is not permitted by allowedProviders (${allowed.join(", ")})`,
      };
    }
    provider = explicitProvider;
  } else {
    const text = `${subtask.type || ""} ${subtask.description || ""}`.toLowerCase();
    for (const rule of rules) {
      if (!rule.match) continue;
      let regex;
      try {
        regex = new RegExp(`\\b(${rule.match})\\b`, "i");
      } catch {
        continue;
      }
      if (regex.test(text)) {
        const candidate = rule.provider || routing.defaultProvider || null;
        if (isAllowed(candidate)) {
          provider = candidate;
          model = subtask.model || rule.model || routing.defaultModel || null;
          effort = subtask.effort || rule.effort || routing.defaultEffort || "medium";
          break;
        }
      }
    }

    if (!provider) {
      if (routing.defaultProvider && isAllowed(routing.defaultProvider)) {
        provider = routing.defaultProvider;
      } else if (allowed) {
        provider = allowed[0];
      } else {
        provider = "opencode";
      }
    }
  }

  return { provider, model, effort };
}

class OrchestrationEngine {
  constructor(options = {}) {
    this.activeSessionId = null;
    this.taskExecutor = typeof options.taskExecutor === "function" ? options.taskExecutor : null;
  }

  /**
   * Initializes and executes (or queues for confirmation) an orchestration plan.
   */
  startOrchestration(plan, options = {}) {
    const projectRoot = options.projectRoot || process.cwd();
    loadPersistedSessions(projectRoot);

    const config = readOrchestrationConfig(projectRoot);
    if (!config.enabled || config.mode === "off") {
      return { ok: false, error: "Orchestration is disabled in settings" };
    }

    const id = options.id || `orch_${crypto.randomUUID().slice(0, 8)}`;
    const rawSubtasks = Array.isArray(plan.subtasks) ? plan.subtasks : [];

    if (rawSubtasks.length === 0) {
      return { ok: false, error: "Plan must contain at least one subtask" };
    }

    const normalizedSubtasks = [];
    for (let index = 0; index < rawSubtasks.length; index += 1) {
      const st = rawSubtasks[index] || {};
      const routing = resolveSubtaskRouting(st, config);
      if (routing.error) {
        return { ok: false, error: routing.error };
      }

      const subtaskId = String(st.id || `st_${index + 1}`);
      const type = String(st.type || "implement");
      const dependsOn = Array.isArray(st.dependsOn) ? st.dependsOn.map(String) : [];
      const readOnly = typeof st.readOnly === "boolean"
        ? st.readOnly
        : READONLY_SUBTASK_TYPES.has(type);

      normalizedSubtasks.push({
        id: subtaskId,
        index: index + 1,
        description: String(st.description || st.task || `Subtask ${index + 1}`),
        type,
        readOnly,
        provider: routing.provider,
        model: routing.model,
        effort: routing.effort,
        dependsOn,
        status: "pending", // 'pending' | 'running' | 'done' | 'failed' | 'cancelled'
        result: null,
        error: null,
        startedAt: null,
        endedAt: null,
        durationMs: 0,
        threadId: null,
      });
    }

    const validation = validatePlanSubtasks(normalizedSubtasks);
    if (!validation.ok) {
      return { ok: false, error: validation.error };
    }

    const effectiveMode = options.mode || config.mode || "auto";
    const needsApproval = effectiveMode === "confirm" && options.approved !== true;
    const strategy = plan.strategy || config.strategy || "smart";
    const configuredMax = Number(config.maxConcurrent) > 0 ? Number(config.maxConcurrent) : 3;

    const session = {
      id,
      task: String(plan.task || "Task Orchestration"),
      status: needsApproval ? "awaiting_approval" : "running",
      mode: effectiveMode,
      strategy,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: null,
      projectRoot,
      subtasks: normalizedSubtasks,
      maxConcurrent: strategy === "sequential" ? 1 : configuredMax,
      timeoutMs: Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : undefined,
      summary: null,
    };

    sessions.set(id, session);
    controllers.set(id, new AbortController());
    this.activeSessionId = id;
    persistSessions(projectRoot);

    if (needsApproval) {
      this.broadcastEvent({
        type: "orchestration_awaiting_approval",
        orchestrationId: id,
        orchestration: this.publicSnapshot(session),
      });
      return {
        ok: true,
        orchestrationId: id,
        awaitingApproval: true,
        orchestration: this.publicSnapshot(session),
      };
    }

    this.broadcastEvent({
      type: "orchestration_started",
      orchestrationId: id,
      orchestration: this.publicSnapshot(session),
    });

    setImmediate(() => {
      this.pump(id);
    });

    return {
      ok: true,
      orchestrationId: id,
      orchestration: this.publicSnapshot(session),
    };
  }

  /**
   * Approves and starts an orchestration currently in `awaiting_approval`.
   */
  approveOrchestration(id) {
    const session = sessions.get(id);
    if (!session) return { ok: false, error: "Orchestration not found" };
    if (session.status !== "awaiting_approval") {
      return { ok: false, error: `Orchestration is not awaiting approval (status: ${session.status})` };
    }

    session.status = "running";
    session.updatedAt = new Date().toISOString();
    if (!controllers.has(id)) {
      controllers.set(id, new AbortController());
    }

    persistSessions(session.projectRoot);
    this.broadcastEvent({
      type: "orchestration_started",
      orchestrationId: id,
      orchestration: this.publicSnapshot(session),
    });

    setImmediate(() => {
      this.pump(id);
    });

    return { ok: true, orchestration: this.publicSnapshot(session) };
  }

  /**
   * Evaluates subtasks ready to execute, respecting dependencies & concurrency.
   */
  async pump(orchestrationId) {
    const session = sessions.get(orchestrationId);
    if (!session || session.status !== "running") return;

    const completedIds = new Set(
      session.subtasks.filter((s) => s.status === "done").map((s) => s.id),
    );
    const failedIds = new Set(
      session.subtasks
        .filter((s) => s.status === "failed" || s.status === "cancelled")
        .map((s) => s.id),
    );

    const running = session.subtasks.filter((s) => s.status === "running");

    // Cancel pending subtasks blocked by a failed/cancelled dependency
    for (const st of session.subtasks) {
      if (st.status === "pending" && st.dependsOn.some((depId) => failedIds.has(depId))) {
        st.status = "cancelled";
        st.error = "Cancelled because a dependency failed";
        st.endedAt = new Date().toISOString();
        this.emitSubtaskUpdate(session, st);
      }
    }

    const allTerminal = session.subtasks.every((s) =>
      ["done", "failed", "cancelled"].includes(s.status),
    );

    if (allTerminal) {
      const anyFailed = session.subtasks.some((s) => s.status === "failed");
      session.status = anyFailed ? "failed" : "done";
      session.completedAt = new Date().toISOString();
      session.updatedAt = new Date().toISOString();
      session.summary = this.buildSummary(session);
      controllers.delete(session.id);

      persistSessions(session.projectRoot);
      this.broadcastEvent({
        type: "orchestration_finished",
        orchestrationId: session.id,
        orchestration: this.publicSnapshot(session),
      });
      return;
    }

    const available = session.subtasks.filter((st) => {
      if (st.status !== "pending") return false;
      return st.dependsOn.every((depId) => completedIds.has(depId));
    });

    const limit = session.strategy === "sequential" ? 1 : (session.maxConcurrent || 3);
    const capacity = Math.max(0, limit - running.length);
    const toStart = available.slice(0, capacity);

    for (const subtask of toStart) {
      this.dispatchSubtask(session, subtask).catch((err) => {
        subtask.status = "failed";
        subtask.error = String(err.message || err);
        subtask.endedAt = new Date().toISOString();
        this.emitSubtaskUpdate(session, subtask);
        this.pump(session.id);
      });
    }
  }

  /**
   * Dispatches an individual subtask to its assigned provider CLI.
   */
  async dispatchSubtask(session, subtask) {
    subtask.status = "running";
    subtask.startedAt = new Date().toISOString();
    session.updatedAt = new Date().toISOString();
    this.emitSubtaskUpdate(session, subtask);
    persistSessions(session.projectRoot);

    const prompt = this.buildSubtaskPrompt(session, subtask);

    try {
      if (process.env.NODE_ENV !== "test" && process.env.FXMIND_SYNTHETIC_ORCH !== "1") {
        try {
          const threadResult = threads.createThread({
            title: `[Orch] ${subtask.description}`.slice(0, 100),
            projectId: path.basename(session.projectRoot) || "fxmind",
            projectRoot: session.projectRoot,
            content: prompt,
            taskType: "orchestration",
            run: false,
          });
          if (threadResult && threadResult.thread) {
            subtask.threadId = threadResult.thread.id;
          }
        } catch {
          // Non-fatal if thread store is unavailable
        }
      }

      const resultText = await this.executeCliTask(session, subtask, prompt);

      if (session.status === "cancelled" || subtask.status === "cancelled") {
        return;
      }

      subtask.status = "done";
      subtask.result = resultText;
      subtask.endedAt = new Date().toISOString();
      subtask.durationMs = Math.max(0, Date.parse(subtask.endedAt) - Date.parse(subtask.startedAt));
      session.updatedAt = new Date().toISOString();

      this.emitSubtaskUpdate(session, subtask);
    } catch (err) {
      if (session.status === "cancelled" || subtask.status === "cancelled") {
        return;
      }
      subtask.status = "failed";
      subtask.error = String(err.message || err);
      subtask.endedAt = new Date().toISOString();
      subtask.durationMs = Math.max(0, Date.parse(subtask.endedAt) - Date.parse(subtask.startedAt));
      session.updatedAt = new Date().toISOString();

      this.emitSubtaskUpdate(session, subtask);
    }

    persistSessions(session.projectRoot);
    setImmediate(() => {
      this.pump(session.id);
    });
  }

  buildSubtaskPrompt(session, subtask) {
    let context = `Main Goal: ${session.task}\n\nYour Subtask: ${subtask.description}\nRole/Type: ${subtask.type}\n`;

    const deps = session.subtasks.filter((s) => subtask.dependsOn.includes(s.id) && s.result);
    if (deps.length > 0) {
      context += `\n--- Context from preceding subtasks ---\n`;
      for (const dep of deps) {
        context += `\n[Result of "${dep.description}"]:\n${dep.result}\n`;
      }
      context += `----------------------------------------\n`;
    }

    context += `\nExecute this subtask thoroughly and provide a clear, concise outcome.`;
    return context;
  }

  async executeCliTask(session, subtask, prompt) {
    const signal = controllers.get(session.id)?.signal;

    if (this.taskExecutor) {
      return this.taskExecutor(session, subtask, prompt, signal);
    }

    if (process.env.FXMIND_SYNTHETIC_ORCH === "1") {
      await new Promise((r) => setTimeout(r, 50));
      if (signal?.aborted) throw new Error("cancelled");
      return `Subtask "${subtask.description}" executed successfully by ${subtask.provider || "agent"}.`;
    }

    const out = await runner.runOrchestratedTask(session.projectRoot, {
      cliId: subtask.provider,
      model: subtask.model,
      effort: subtask.effort,
      prompt,
      readOnly: subtask.readOnly,
      timeoutMs: session.timeoutMs,
      signal,
    });

    if (!out || !out.ok) {
      throw new Error(out?.error || `Execution failed on provider ${subtask.provider}`);
    }

    return out.output;
  }

  /**
   * Waits until an orchestration reaches a terminal state (or awaiting_approval),
   * or until timeoutMs elapses.
   */
  waitForOrchestration(id, timeoutMs = 300_000) {
    const initial = this.getOrchestration(id);
    if (!initial) {
      return Promise.resolve({ ok: false, error: "Orchestration not found" });
    }
    if (["done", "failed", "cancelled", "awaiting_approval"].includes(initial.status)) {
      return Promise.resolve({
        ok: initial.status !== "failed",
        awaitingApproval: initial.status === "awaiting_approval",
        orchestration: initial,
      });
    }

    return new Promise((resolve) => {
      let settled = false;
      const done = (payload) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        unsubscribe();
        resolve(payload);
      };

      const unsubscribe = this.subscribe(id, (evt) => {
        const snap = evt.orchestration || this.getOrchestration(id);
        if (!snap) return;
        if (["done", "failed", "cancelled", "awaiting_approval"].includes(snap.status)) {
          done({
            ok: snap.status !== "failed",
            awaitingApproval: snap.status === "awaiting_approval",
            orchestration: snap,
          });
        }
      });

      const timer = setTimeout(() => {
        const current = this.getOrchestration(id);
        done({
          ok: true,
          timedOut: true,
          orchestration: current,
        });
      }, Math.max(100, Number(timeoutMs) || 300_000));
    });
  }

  buildSummary(session) {
    const total = session.subtasks.length;
    const completed = session.subtasks.filter((s) => s.status === "done").length;
    const failed = session.subtasks.filter((s) => s.status === "failed").length;
    const cancelled = session.subtasks.filter((s) => s.status === "cancelled").length;

    return {
      total,
      completed,
      failed,
      cancelled,
      durationMs: session.completedAt
        ? Math.max(0, Date.parse(session.completedAt) - Date.parse(session.createdAt))
        : 0,
      status: session.status,
    };
  }

  cancelOrchestration(id) {
    const session = sessions.get(id);
    if (!session) return { ok: false, error: "Orchestration not found" };

    if (session.status === "running" || session.status === "awaiting_approval") {
      session.status = "cancelled";
      session.completedAt = new Date().toISOString();
      session.updatedAt = new Date().toISOString();

      const controller = controllers.get(id);
      if (controller) {
        try {
          controller.abort();
        } catch {
          /* ignore */
        }
        controllers.delete(id);
      }

      for (const st of session.subtasks) {
        if (st.status === "pending" || st.status === "running") {
          st.status = "cancelled";
          st.error = "Cancelled by user";
          st.endedAt = new Date().toISOString();
        }
      }

      session.summary = this.buildSummary(session);
      persistSessions(session.projectRoot);
      this.broadcastEvent({
        type: "orchestration_cancelled",
        orchestrationId: session.id,
        orchestration: this.publicSnapshot(session),
      });
    }

    return { ok: true, orchestration: this.publicSnapshot(session) };
  }

  emitSubtaskUpdate(session, subtask) {
    this.broadcastEvent({
      type: "subtask_updated",
      orchestrationId: session.id,
      subtask,
      overallProgress: this.calculateProgress(session),
    });
  }

  calculateProgress(session) {
    if (!session.subtasks.length) return 0;
    const terminal = session.subtasks.filter((s) =>
      ["done", "failed", "cancelled"].includes(s.status),
    ).length;
    return Math.round((terminal / session.subtasks.length) * 100);
  }

  broadcastEvent(event) {
    emitter.emit("event", event);
    if (event.orchestrationId) {
      emitter.emit(`event:${event.orchestrationId}`, event);
    }
  }

  subscribe(orchestrationId, callback) {
    const handler = (evt) => callback(evt);
    emitter.on(`event:${orchestrationId}`, handler);
    return () => emitter.off(`event:${orchestrationId}`, handler);
  }

  subscribeAll(callback) {
    const handler = (evt) => callback(evt);
    emitter.on("event", handler);
    return () => emitter.off("event", handler);
  }

  publicSnapshot(session) {
    if (!session) return null;
    return {
      id: session.id,
      task: session.task,
      status: session.status,
      mode: session.mode || "auto",
      strategy: session.strategy,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      completedAt: session.completedAt || null,
      projectRoot: session.projectRoot,
      progress: this.calculateProgress(session),
      subtasks: session.subtasks,
      summary: session.summary || null,
    };
  }

  getActiveOrchestration(projectRoot = null) {
    if (projectRoot) {
      loadPersistedSessions(projectRoot);
    }

    if (this.activeSessionId && sessions.has(this.activeSessionId)) {
      const active = sessions.get(this.activeSessionId);
      if (active.status === "running" || active.status === "awaiting_approval") {
        return this.publicSnapshot(active);
      }
    }

    for (const session of sessions.values()) {
      if (session.status === "running" || session.status === "awaiting_approval") {
        if (!projectRoot || session.projectRoot === projectRoot) {
          return this.publicSnapshot(session);
        }
      }
    }

    const all = Array.from(sessions.values()).filter(
      (s) => !projectRoot || s.projectRoot === projectRoot,
    );
    if (all.length > 0) {
      const sorted = all.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
      return this.publicSnapshot(sorted[0]);
    }

    return null;
  }

  getOrchestration(id, projectRoot = null) {
    if (!sessions.has(id) && projectRoot) {
      loadPersistedSessions(projectRoot);
    }
    const session = sessions.get(id);
    return session ? this.publicSnapshot(session) : null;
  }

  listOrchestrations(limit = 20, projectRoot = null) {
    if (projectRoot) {
      loadPersistedSessions(projectRoot);
    }
    return Array.from(sessions.values())
      .filter((s) => !projectRoot || s.projectRoot === projectRoot)
      .map((s) => this.publicSnapshot(s))
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .slice(0, limit);
  }
}

const engine = new OrchestrationEngine();

module.exports = {
  OrchestrationEngine,
  engine,
  resolveSubtaskRouting,
  validatePlanSubtasks,
};
