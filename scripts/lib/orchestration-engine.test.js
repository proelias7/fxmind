const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const panelOrch = require("./panel-orchestration");
const {
  OrchestrationEngine,
  resolveSubtaskRouting,
  validatePlanSubtasks,
} = require("./orchestration-engine");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe("orchestration-engine", () => {
  let tmpHome;
  let projectRoot;
  let prevHome;
  let prevUserProfile;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "fxeng-home-"));
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fxeng-proj-"));
    prevHome = process.env.HOME;
    prevUserProfile = process.env.USERPROFILE;
    if (process.platform === "win32") {
      process.env.USERPROFILE = tmpHome;
    } else {
      process.env.HOME = tmpHome;
    }
  });

  afterEach(() => {
    if (prevUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = prevUserProfile;
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    fs.rmSync(tmpHome, { recursive: true, force: true });
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it("validates DAG structure and rejects cycles, self-dependencies, duplicates, and unknown deps", () => {
    // 2-node cycle: A -> B -> A
    const cycle2 = validatePlanSubtasks([
      { id: "a", dependsOn: ["b"] },
      { id: "b", dependsOn: ["a"] },
    ]);
    assert.equal(cycle2.ok, false);
    assert.match(cycle2.error, /cycle/i);

    // 3-node cycle: st_1 -> st_2 -> st_3 -> st_1
    const cycle3 = validatePlanSubtasks([
      { id: "st_1", dependsOn: ["st_3"] },
      { id: "st_2", dependsOn: ["st_1"] },
      { id: "st_3", dependsOn: ["st_2"] },
    ]);
    assert.equal(cycle3.ok, false);
    assert.match(cycle3.error, /cycle/i);

    // Self-dependency
    const selfDep = validatePlanSubtasks([{ id: "st_1", dependsOn: ["st_1"] }]);
    assert.equal(selfDep.ok, false);
    assert.match(selfDep.error, /itself/i);

    // Unknown dependency
    const unknownDep = validatePlanSubtasks([{ id: "st_1", dependsOn: ["missing"] }]);
    assert.equal(unknownDep.ok, false);
    assert.match(unknownDep.error, /unknown subtask/i);

    // Duplicate IDs
    const dup = validatePlanSubtasks([
      { id: "st_1", dependsOn: [] },
      { id: "st_1", dependsOn: [] },
    ]);
    assert.equal(dup.ok, false);
    assert.match(dup.error, /duplicate/i);

    // Engine startOrchestration refuses invalid DAG before creating session
    const eng = new OrchestrationEngine({ taskExecutor: async () => "ok" });
    const started = eng.startOrchestration(
      {
        task: "Broken cycle plan",
        subtasks: [
          { id: "a", description: "Step A", dependsOn: ["b"] },
          { id: "b", description: "Step B", dependsOn: ["a"] },
        ],
      },
      { projectRoot },
    );
    assert.equal(started.ok, false);
    assert.match(started.error, /cycle/i);
  });

  it("enforces maxConcurrent during parallel execution", async () => {
    panelOrch.putOrchestrationSettings(projectRoot, {
      scope: "project",
      config: { maxConcurrent: 2, strategy: "parallel" },
    });

    let activeCount = 0;
    let peakActive = 0;

    const eng = new OrchestrationEngine({
      taskExecutor: async (_session, subtask) => {
        activeCount += 1;
        peakActive = Math.max(peakActive, activeCount);
        await sleep(30);
        activeCount -= 1;
        return `done:${subtask.id}`;
      },
    });

    const started = eng.startOrchestration(
      {
        task: "Run 5 independent subtasks with maxConcurrent=2",
        subtasks: [
          { id: "s1", description: "Explore module 1", type: "explore" },
          { id: "s2", description: "Explore module 2", type: "explore" },
          { id: "s3", description: "Explore module 3", type: "explore" },
          { id: "s4", description: "Explore module 4", type: "explore" },
          { id: "s5", description: "Explore module 5", type: "explore" },
        ],
      },
      { projectRoot },
    );

    assert.equal(started.ok, true);
    const finalRes = await eng.waitForOrchestration(started.orchestrationId, 5000);
    assert.equal(finalRes.ok, true);
    assert.equal(finalRes.orchestration.status, "done");
    assert.equal(peakActive, 2);
    assert.equal(finalRes.orchestration.summary.completed, 5);
  });

  it("forces concurrency = 1 when strategy is sequential", async () => {
    panelOrch.putOrchestrationSettings(projectRoot, {
      scope: "project",
      config: { maxConcurrent: 4, strategy: "sequential" },
    });

    let activeCount = 0;
    let peakActive = 0;
    const order = [];

    const eng = new OrchestrationEngine({
      taskExecutor: async (_session, subtask) => {
        activeCount += 1;
        peakActive = Math.max(peakActive, activeCount);
        order.push(subtask.id);
        await sleep(20);
        activeCount -= 1;
        return `ok:${subtask.id}`;
      },
    });

    const started = eng.startOrchestration(
      {
        task: "Sequential run",
        strategy: "sequential",
        subtasks: [
          { id: "first", description: "First step" },
          { id: "second", description: "Second step" },
          { id: "third", description: "Third step" },
        ],
      },
      { projectRoot },
    );

    assert.equal(started.ok, true);
    const done = await eng.waitForOrchestration(started.orchestrationId, 5000);
    assert.equal(done.orchestration.status, "done");
    assert.equal(peakActive, 1);
    assert.deepEqual(order, ["first", "second", "third"]);
  });

  it("respects DAG dependsOn order and propagates upstream results into downstream prompts", async () => {
    const promptsBySubtask = new Map();
    const executionOrder = [];

    const eng = new OrchestrationEngine({
      taskExecutor: async (_session, subtask, prompt) => {
        executionOrder.push(subtask.id);
        promptsBySubtask.set(subtask.id, prompt);
        await sleep(15);
        return `OUTPUT_OF_${subtask.id}`;
      },
    });

    const started = eng.startOrchestration(
      {
        task: "Build and verify feature",
        subtasks: [
          { id: "explore", description: "Inspect auth files", type: "explore" },
          { id: "implement", description: "Implement JWT middleware", type: "implement", dependsOn: ["explore"] },
          { id: "review", description: "Audit JWT middleware", type: "review", dependsOn: ["implement"] },
        ],
      },
      { projectRoot },
    );

    assert.equal(started.ok, true);
    const res = await eng.waitForOrchestration(started.orchestrationId, 5000);
    assert.equal(res.orchestration.status, "done");
    assert.deepEqual(executionOrder, ["explore", "implement", "review"]);

    // Downstream subtasks receive upstream output in their prompt
    assert.match(promptsBySubtask.get("implement"), /OUTPUT_OF_explore/);
    assert.match(promptsBySubtask.get("review"), /OUTPUT_OF_implement/);
  });

  it("cancels downstream dependent subtasks in cascade when an upstream dependency fails", async () => {
    const eng = new OrchestrationEngine({
      taskExecutor: async (_session, subtask) => {
        if (subtask.id === "step_a") {
          throw new Error("Simulated build failure in step A");
        }
        return `completed:${subtask.id}`;
      },
    });

    const started = eng.startOrchestration(
      {
        task: "Pipeline with failing upstream step",
        subtasks: [
          { id: "step_a", description: "Failing step" },
          { id: "step_b", description: "Depends on A", dependsOn: ["step_a"] },
          { id: "step_c", description: "Depends on B", dependsOn: ["step_b"] },
          { id: "independent", description: "Independent task" },
        ],
      },
      { projectRoot },
    );

    assert.equal(started.ok, true);
    const res = await eng.waitForOrchestration(started.orchestrationId, 5000);
    assert.equal(res.orchestration.status, "failed");

    const byId = Object.fromEntries(res.orchestration.subtasks.map((s) => [s.id, s]));
    assert.equal(byId.step_a.status, "failed");
    assert.match(byId.step_a.error, /Simulated build failure/);
    assert.equal(byId.step_b.status, "cancelled");
    assert.equal(byId.step_c.status, "cancelled");
    assert.equal(byId.independent.status, "done");
  });

  it("holds execution in awaiting_approval when mode is confirm and runs after approveOrchestration", async () => {
    panelOrch.putOrchestrationSettings(projectRoot, {
      scope: "project",
      config: { mode: "confirm" },
    });

    let executed = 0;
    const eng = new OrchestrationEngine({
      taskExecutor: async (_session, subtask) => {
        executed += 1;
        return `ran:${subtask.id}`;
      },
    });

    const started = eng.startOrchestration(
      {
        task: "Requires human approval",
        subtasks: [{ id: "st_1", description: "Refactor server route", type: "implement" }],
      },
      { projectRoot },
    );

    assert.equal(started.ok, true);
    assert.equal(started.awaitingApproval, true);
    assert.equal(started.orchestration.status, "awaiting_approval");

    await sleep(40);
    assert.equal(executed, 0);

    const approved = eng.approveOrchestration(started.orchestrationId);
    assert.equal(approved.ok, true);

    const finished = await eng.waitForOrchestration(started.orchestrationId, 5000);
    assert.equal(finished.orchestration.status, "done");
    assert.equal(executed, 1);

    // State snapshot persisted on disk
    const stateFile = path.join(projectRoot, ".fxmind", "state", "orchestrations.json");
    assert.equal(fs.existsSync(stateFile), true);
    const persisted = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    const foundPersisted = persisted.find((s) => s.id === started.orchestrationId);
    assert.ok(foundPersisted);
    assert.equal(foundPersisted.status, "done");
  });

  it("aborts in-flight subtasks and marks session cancelled on cancelOrchestration", async () => {
    let signalAborted = false;
    const eng = new OrchestrationEngine({
      taskExecutor: async (_session, _subtask, _prompt, signal) => {
        await new Promise((resolve) => {
          signal.addEventListener("abort", () => {
            signalAborted = true;
            resolve();
          });
        });
        throw new Error("cancelled");
      },
    });

    const started = eng.startOrchestration(
      {
        task: "Long task to cancel",
        subtasks: [
          { id: "st_1", description: "Long step 1" },
          { id: "st_2", description: "Queued step 2", dependsOn: ["st_1"] },
        ],
      },
      { projectRoot },
    );

    assert.equal(started.ok, true);
    await sleep(25);

    const cancelled = eng.cancelOrchestration(started.orchestrationId);
    assert.equal(cancelled.ok, true);
    assert.equal(cancelled.orchestration.status, "cancelled");
    assert.equal(signalAborted, true);
    assert.ok(cancelled.orchestration.subtasks.every((s) => s.status === "cancelled"));
  });

  it("routes subtasks by rules and enforces allowedProviders policy", () => {
    const baseCfg = panelOrch.DEFAULT_ORCHESTRATION;

    const rExplore = resolveSubtaskRouting({ type: "explore", description: "find files" }, baseCfg);
    assert.equal(rExplore.provider, "opencode");
    assert.equal(rExplore.effort, "low");

    const rReview = resolveSubtaskRouting({ type: "review", description: "audit security" }, baseCfg);
    assert.equal(rReview.provider, "claude");
    assert.equal(rReview.effort, "high");

    const rImpl = resolveSubtaskRouting({ type: "implement", description: "write handler" }, baseCfg);
    assert.equal(rImpl.provider, "codex");
    assert.equal(rImpl.effort, "medium");

    // Restricted allowedProviders falls back to permitted provider when rule provider is disallowed
    const restrictedCfg = {
      ...baseCfg,
      allowedProviders: ["claude"],
    };
    const rFallback = resolveSubtaskRouting({ type: "implement", description: "write handler" }, restrictedCfg);
    assert.equal(rFallback.provider, "claude");

    // Explicit disallowed provider returns clear error
    const rDisallowed = resolveSubtaskRouting(
      { type: "implement", description: "write handler", provider: "codex" },
      restrictedCfg,
    );
    assert.match(rDisallowed.error, /not permitted by allowedProviders/i);
  });
});
