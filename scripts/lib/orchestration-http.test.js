"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const readline = require("node:readline");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createServer } = require("../serve");
const { brokerCall } = require("./orchestration-client");

test("MCP commands and HTTP/SSE panel control the same broker session", { timeout: 30000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fxmind-orch-http-"));
  fs.mkdirSync(path.join(root, ".fxmind"), { recursive: true });
  const previous = process.env.FXMIND_SYNTHETIC_ORCH;
  process.env.FXMIND_SYNTHETIC_ORCH = "1";
  const server = createServer();
  const child = spawn(process.execPath, [path.join(__dirname, "..", "mcp-server.js")], {
    cwd: root,
    env: { ...process.env, FXMIND_TARGET: root, FXMIND_MCP_TOOLS: "all" },
    stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
  });
  const pending = new Map();
  const reader = readline.createInterface({ input: child.stdout });
  reader.on("line", (line) => {
    let message;
    try { message = JSON.parse(line); } catch { return; }
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    clearTimeout(entry.timer);
    entry.resolve(message);
  });
  let n = 0;
  function mcp(name, args) {
    return new Promise((resolve, reject) => {
      const id = ++n;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error("MCP timed out: " + name));
      }, 12000);
      pending.set(id, { resolve, timer });
      child.stdin.write(JSON.stringify({
        jsonrpc: "2.0", id, method: "tools/call",
        params: { name, arguments: args },
      }) + "\n");
    });
  }
  let brokerStarted = false;
  let sseController;
  try {
    await new Promise((resolve, reject) => {
      server.listen(0, "127.0.0.1", resolve);
      server.once("error", reject);
    });
    const base = "http://127.0.0.1:" + server.address().port;
    const q = "?root=" + encodeURIComponent(root);
    const config = await fetch(base + "/api/orchestration/config" + q, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config: { enabled: true, mode: "confirm" } }),
    }).then((res) => res.json());
    assert.equal(config.ok, true);
    brokerStarted = true;

    const startResponse = await mcp("fxmind_orchestrate", {
      task: "http + mcp integration", wait: false,
      subtasks: [{ id: "first", description: "Implement", type: "implement", provider: "codex" }],
    });
    assert.ok(startResponse.result?.content?.[0]?.text);
    const started = JSON.parse(startResponse.result.content[0].text);
    assert.equal(started.ok, true);
    assert.equal(started.orchestration.status, "awaiting_approval");

    const detail = await fetch(base + "/api/orchestration/" + started.orchestrationId + q).then((r) => r.json());
    assert.equal(detail.orchestration.status, "awaiting_approval");

    sseController = new AbortController();
    const stream = await fetch(base + "/api/orchestration/stream" + q, { signal: sseController.signal });
    assert.equal(stream.status, 200);
    const first = await stream.body.getReader().read();
    assert.match(Buffer.from(first.value).toString("utf8"), /snapshot/);

    const approved = await fetch(base + "/api/orchestration/" + started.orchestrationId + "/approve" + q, {
      method: "POST",
    }).then((r) => r.json());
    assert.equal(approved.ok, true);
    const statusResponse = await mcp("fxmind_orchestration_status", { orchestrationId: started.orchestrationId });
    const status = JSON.parse(statusResponse.result.content[0].text);
    assert.equal(status.ok, true);
    assert.ok(["running", "done"].includes(status.orchestration.status));

    const finish = await brokerCall(root, "wait", { id: started.orchestrationId, timeoutMs: 5000 });
    assert.equal(finish.orchestration.status, "done");
  } finally {
    sseController?.abort();
    child.stdin.end();
    child.kill();
    reader.close();
    await new Promise((resolve) => server.close(resolve));
    if (brokerStarted) await brokerCall(root, "test_shutdown").catch(() => {});
    await new Promise((r) => setTimeout(r, 200));
    try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* clean best effort */ }
    if (previous === undefined) delete process.env.FXMIND_SYNTHETIC_ORCH;
    else process.env.FXMIND_SYNTHETIC_ORCH = previous;
  }
});
