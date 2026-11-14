"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { brokerCall } = require("./orchestration-client");

test("MCP and panel share a project-scoped orchestration broker", async () => {
  const previousSynthetic = process.env.FXMIND_SYNTHETIC_ORCH;
  process.env.FXMIND_SYNTHETIC_ORCH = "1";
  const a = fs.mkdtempSync(path.join(os.tmpdir(), "fxmind-orch-int-a-"));
  const b = fs.mkdtempSync(path.join(os.tmpdir(), "fxmind-orch-int-b-"));
  let aStarted = false;
  let bStarted = false;
  try {
    for (const root of [a, b]) fs.mkdirSync(path.join(root, ".fxmind"), { recursive: true });
    assert.equal((await brokerCall(a, "config_set", {
      config: { enabled: true, mode: "confirm", maxConcurrent: 2 },
    })).ok, true);
    aStarted = true;
    const forbidden = await brokerCall(a, "start", {
      plan: { task: "unsafe", subtasks: [
        { id: "unsafe", description: "Explore using a writable CLI", type: "explore", provider: "opencode" },
      ] },
    });
    assert.equal(forbidden.ok, false);
    assert.match(forbidden.error, /read-only/i);
    const started = await brokerCall(a, "start", {
      plan: { task: "demo", subtasks: [
        { id: "inspect", description: "Read project", type: "explore" },
        { id: "code", description: "Implement feature", type: "implement", dependsOn: ["inspect"] },
      ] },
      // Request payloads must not bypass a project-level confirmation policy.
      mode: "auto", approved: true,
    });
    assert.equal(started.ok, true);
    assert.equal(started.orchestration.status, "awaiting_approval");
    // Cross-project reads/controls must not find the session.
    const foreign = await brokerCall(b, "status", { id: started.orchestrationId });
    bStarted = true;
    assert.equal(foreign.ok, false);
    assert.equal((await brokerCall(b, "approve", { id: started.orchestrationId })).ok, false);
    const approved = await brokerCall(a, "approve", { id: started.orchestrationId });
    assert.equal(approved.ok, true);
    const finished = await brokerCall(a, "wait", {
      id: started.orchestrationId, timeoutMs: 20000,
    }, 25000);
    assert.equal(finished.ok, true);
    assert.equal(finished.orchestration.status, "done");
    assert.equal(finished.orchestration.subtasks[0].status, "done");
    assert.equal(finished.orchestration.subtasks[1].status, "done");
    assert.ok(fs.existsSync(path.join(a, ".fxmind", "state", "orchestrations.json")));
    assert.ok(!fs.existsSync(path.join(b, ".fxmind", "state", "orchestrations.json")));
  } finally {
    if (aStarted) await brokerCall(a, "test_shutdown").catch(() => null);
    if (bStarted) await brokerCall(b, "test_shutdown").catch(() => null);
    await new Promise((r) => setTimeout(r, 200));
    for (const root of [a, b]) {
      try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* test cleanup */ }
    }
    if (previousSynthetic === undefined) delete process.env.FXMIND_SYNTHETIC_ORCH;
    else process.env.FXMIND_SYNTHETIC_ORCH = previousSynthetic;
  }
});

test("stale running sessions are failed safely on restart without re-executing them", async () => {
  const { OrchestrationEngine } = require("./orchestration-engine");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fxmind-orch-recovery-"));
  const file = path.join(root, ".fxmind", "state", "orchestrations.json");
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const id = "recovery_" + Math.random().toString(36).slice(2);
    fs.writeFileSync(file, JSON.stringify([{
      id, task: "interrupted", projectRoot: root, status: "running", createdAt: new Date().toISOString(),
      subtasks: [
        { id: "a", status: "done", dependsOn: [] },
        { id: "b", status: "running", dependsOn: ["a"] },
        { id: "c", status: "pending", dependsOn: ["b"] },
      ],
    }]));
    const engine = new OrchestrationEngine();
    const session = engine.getOrchestration(id, root);
    assert.equal(session.status, "failed");
    assert.deepEqual(session.subtasks.map((s) => s.status), ["done", "failed", "cancelled"]);
    assert.equal(JSON.parse(fs.readFileSync(file, "utf8"))[0].status, "failed");
    assert.equal(engine.getOrchestration(id, os.tmpdir()), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
