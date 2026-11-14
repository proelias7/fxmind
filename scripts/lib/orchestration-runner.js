/**
 * scripts/lib/orchestration-runner.js
 *
 * Executes a single orchestrated subtask against any supported CLI provider
 * (opencode, claude, codex, cursor-agent, hermes) with model/effort overrides,
 * BYOK provider environment variables, read-only enforcement, and AbortSignal.
 */
"use strict";

const { spawn, execFileSync } = require("child_process");
const path = require("path");
const { readPanelConfig } = require("./panel-api");
const panelCli = require("./panel-cli");
const panelProviders = require("./panel-providers");
const stream = require("./panel-cli-stream");

const DEFAULT_TASK_TIMEOUT_MS = 5 * 60 * 1000;
const PROMPT_MAX_CHARS = 56000;

function terminateProcess(child) {
  if (!child) return;
  if (process.platform === "win32" && child.pid) {
    try {
      execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      });
      return;
    } catch {
      /* fallback to child.kill */
    }
  }
  if (typeof child.kill === "function") {
    try {
      child.kill();
    } catch {
      /* ignore */
    }
  }
}

function buildRunnerEnv(root, readOnly = false) {
  const config = readPanelConfig();
  const byok = config.byok || {};
  const env = {
    ...process.env,
    ...panelProviders.providersEnv(),
  };

  if (byok.anthropic) env.ANTHROPIC_API_KEY = byok.anthropic;
  if (byok.openai) env.OPENAI_API_KEY = byok.openai;
  if (byok.openaiBaseUrl) env.OPENAI_BASE_URL = byok.openaiBaseUrl;
  if (byok.cursor) env.CURSOR_API_KEY = byok.cursor;

  if (root) {
    const resolvedCwd = path.resolve(root);
    env.FXMIND_TARGET = resolvedCwd;
    env.CLAUDE_PROJECT_DIR = resolvedCwd;
  }

  if (readOnly) {
    env.FXMIND_MCP_READONLY = "1";
  }

  return env;
}

function spawnRunnerProcess(bin, args, cwd, env, needsStdin) {
  const childEnv = { ...env };
  if (process.platform === "win32" && /cursor-?agent|(?:^|[\\/])agent\.(?:cmd|bat|exe)$/i.test(bin)) {
    delete childEnv.SHELL;
    delete childEnv.MSYSTEM;
  }
  const opts = {
    cwd: cwd ? path.resolve(cwd) : process.cwd(),
    env: childEnv,
    windowsHide: true,
    stdio: needsStdin ? ["pipe", "pipe", "pipe"] : ["ignore", "pipe", "pipe"],
  };
  if (process.platform === "win32" && /\.(cmd|bat)$/i.test(bin)) {
    return spawn("cmd.exe", ["/d", "/s", "/c", bin, ...args], opts);
  }
  return spawn(bin, args, opts);
}

/**
 * Runs one orchestrated subtask on the requested CLI provider.
 *
 * @param {string} root - Project root directory
 * @param {Object} options
 * @param {string} [options.cliId] - Provider CLI id (opencode | claude | codex | cursor-agent | hermes)
 * @param {string|null} [options.model] - Optional model override
 * @param {string|null} [options.effort] - Optional effort level (low | medium | high | max)
 * @param {string} options.prompt - Full task prompt
 * @param {boolean} [options.readOnly=false] - Enforce read-only tools & FXMIND_MCP_READONLY=1
 * @param {number} [options.timeoutMs] - Execution timeout in milliseconds
 * @param {AbortSignal} [options.signal] - Optional abort signal for cancellation
 */
async function runOrchestratedTask(root, options = {}) {
  const config = readPanelConfig();
  const requestedCli = options.cliId ? String(options.cliId).trim() : "";
  const cliId = requestedCli || panelCli.pickCliId(null);
  if (!cliId) {
    return { ok: false, error: "no cli available for orchestrated task" };
  }

  const scanned = panelCli.scanCli({ quick: true });
  const cliInfo = scanned.find((c) => c.id === cliId);
  if (!cliInfo) {
    return { ok: false, error: `unknown cli "${cliId}"` };
  }
  if (!cliInfo.installed || !cliInfo.bin) {
    return { ok: false, error: `cli "${cliId}" is not installed or lacks a local binary` };
  }

  // Hermes does not use the same MCP installer as the other CLI providers.
  // It can still run tasks, but read-only mode remains blocked below.
  if (cliId !== "hermes") {
    const mcp = panelCli.ensureCliMcp(root, cliId);
    if (!mcp.ok) return { ok: false, error: mcp.error };
  }

  const forceReadOnly = Boolean(options.readOnly);
  // Only these CLIs have an enforced noninteractive read-only execution mode.
  // FXMIND_MCP_READONLY protects only FxMind MCP tools, not shell/file writes.
  if (forceReadOnly && !["codex", "claude"].includes(cliId)) {
    return { ok: false, error: `read-only orchestration requires codex or claude; "${cliId}" has no enforced sandbox` };
  }
  const accessMode = forceReadOnly ? "ask" : panelCli.normalizeAccessMode(config.agent?.accessMode);
  const accessArgs = panelCli.cliAccessArgs(cliId, accessMode);
  const execOpts = {
    // Never inherit the main chat model across providers (Claude/Codex/OpenCode
    // may use incompatible model IDs or different gateway credentials).
    model: options.model || null,
    effort: options.effort || config.agent?.effort || "default",
    variant: null,
    claudeEffort: cliId === "claude" && ["low", "medium", "high"].includes(options.effort)
      ? options.effort
      : cliId === "claude" && options.effort === "max" ? "high" : null,
  };

  const body = String(options.prompt || "").slice(0, PROMPT_MAX_CHARS);
  const { args, stdinPrompt } = panelCli.buildJudgeArgs(cliId, {
    root,
    body,
    accessArgs,
    execOpts,
    readOnly: forceReadOnly,
  });
  if (forceReadOnly && cliId === "claude") {
    // Bash(git ...*) could be abused through shell arguments or git hooks.
    // Block Bash entirely in orchestrated read-only jobs.
    for (let i = args.length - 1; i >= 0; i -= 1) {
      if (/^Bash\(/.test(args[i])) args.splice(i, 1);
    }
    args.push("Bash"); // last argument belongs to --disallowedTools
  }

  return new Promise((resolve) => {
    if (options.signal?.aborted) {
      resolve({ ok: false, error: "cancelled" });
      return;
    }

    let child;
    try {
      child = spawnRunnerProcess(
        cliInfo.bin,
        args,
        root,
        buildRunnerEnv(root, forceReadOnly),
        cliId === "codex" || Boolean(stdinPrompt),
      );
    } catch (err) {
      resolve({ ok: false, error: String(err.message || err) });
      return;
    }

    let settled = false;
    let stdout = "";
    let textOut = "";
    let lineTail = "";
    let cliError = "";
    let stderrPreview = "";

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (options.signal) {
        options.signal.removeEventListener("abort", onAbort);
      }
      resolve(result);
    };

    const onAbort = () => {
      terminateProcess(child);
      finish({ ok: false, error: "cancelled" });
    };

    if (options.signal) {
      options.signal.addEventListener("abort", onAbort, { once: true });
    }

    const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : DEFAULT_TASK_TIMEOUT_MS;
    const timer = setTimeout(() => {
      terminateProcess(child);
      finish({
        ok: false,
        error: `orchestrated task (${cliId}) timed out after ${Math.round(timeoutMs / 1000)}s`,
      });
    }, timeoutMs);

    if (child.stdout) child.stdout.setEncoding("utf8");
    if (child.stderr) child.stderr.setEncoding("utf8");

    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
      const lines = (lineTail + String(chunk)).split("\n");
      lineTail = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          for (const event of stream.parseLineEnriched(line, cliId)) {
            if (event.kind === "text" && event.text) textOut += event.text;
            if (event.kind === "cli" && event.status === "error" && event.detail) {
              cliError = String(event.detail).slice(0, 400);
            }
          }
        } catch {
          /* plain-text CLIs (claude/hermes) emit plain lines */
        }
      }
    });

    child.stderr?.on("data", (chunk) => {
      stderrPreview = (stderrPreview + String(chunk)).slice(-3000);
      const line = String(chunk).slice(0, 2000);
      if (/\bmcp\b/i.test(line)) cliError = "MCP startup or permission failure";
      else if (/auth|login|unauthorized/i.test(line)) cliError = "provider authentication failure";
      else if (/model.*(not found|invalid)|unknown model/i.test(line)) cliError = "provider model unavailable";
    });

    if (stdinPrompt && child.stdin) {
      child.stdin.write(stdinPrompt);
      child.stdin.end();
    }

    child.on("error", (err) => {
      finish({ ok: false, error: String(err.message || err) });
    });

    child.on("close", (code, signal) => {
      if (lineTail.trim()) {
        try {
          for (const event of stream.parseLineEnriched(lineTail, cliId)) {
            if (event.kind === "text" && event.text) textOut += event.text;
            if (event.kind === "cli" && event.status === "error" && event.detail) {
              cliError = String(event.detail).slice(0, 400);
            }
          }
        } catch {
          /* ignore trailing non-JSON text */
        }
      }

      const text = (textOut || stdout).trim();
      if (code !== 0 || signal) {
        const safePreview = stderrPreview
          .replace(/sk-[\w-]{8,}/gi, "[redacted]")
          .replace(/((?:api[_ -]?key|token)\s*[:=]\s*)\S+/gi, "$1[redacted]")
          .replace(/\s+/g, " ").trim().slice(-350);
        const suffix = cliError ? `: ${cliError}` : safePreview ? `: ${safePreview}` : "";
        finish({
          ok: false,
          error: `orchestrated task (${cliId}) exited with code ${code == null ? "unknown" : code}${signal ? ` (signal ${signal})` : ""}${suffix}`,
        });
        return;
      }

      if (!text) {
        finish({
          ok: false,
          error: `orchestrated task (${cliId}) returned no text${cliError ? `: ${cliError}` : ""}`,
        });
        return;
      }

      finish({
        ok: true,
        cliId,
        model: execOpts.model || null,
        effort: execOpts.effort || "default",
        output: text,
      });
    });
  });
}

module.exports = {
  runOrchestratedTask,
  terminateProcess,
};
