const { it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const readline = require("readline");
const { spawn, execFileSync } = require("child_process");

/** Runs `use(call, root)` against a real MCP server over stdio, its reviewer answering `reviewer`. */
async function withServer(reviewer, use) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fxmcp-verify-"));
  fs.writeFileSync(path.join(root, "server.js"), "module.exports = 'save';");
  const child = spawn(process.execPath, [path.join(__dirname, "mcp-server.js")], {
    cwd: root, env: { ...process.env, NODE_ENV: "test", FXMIND_TARGET: root, FXMIND_SESSION_ID: "", FXMIND_AGENT_ID: "codex", FXMIND_TEST_REVIEWER_RESULT: reviewer },
    stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
  });
  const lines = readline.createInterface({ input: child.stdout });
  const pending = new Map();
  let id = 0;
  lines.on("line", (line) => {
    const response = JSON.parse(line);
    pending.get(response.id)?.(response);
  });
  const call = (name, args = {}) => new Promise((resolve, reject) => {
    const requestId = ++id;
    const timeout = setTimeout(() => { pending.delete(requestId); reject(new Error(`MCP timeout: ${name}`)); }, 10000);
    pending.set(requestId, (response) => {
      clearTimeout(timeout);
      pending.delete(requestId);
      resolve(response.result);
    });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: requestId, method: "tools/call", params: { name, arguments: args } }) + "\n");
  });
  try {
    await use(call, root);
  } finally {
    lines.close();
    child.stdin.end();
    await new Promise((resolve) => { child.once("exit", resolve); child.kill(); });
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const evidence = {
  files: ["server.js"], review: "Fixture source inspected",
  ui: { changed: false, reason: "Only server implementation changed; no rendered content or interaction changes." },
  checks: [{ kind: "lint", target: "node --check server.js", expected: "valid JavaScript syntax", observed: "exit 0", status: "passed" }],
};
const text = (result) => JSON.parse(result.content[0].text);

it("MCP transports evidence and rejects false completion through the public tools", async () => {
  await withServer("verified", async (call, root) => {
    const search = text(await call("fxmind_search", { query: "save" }));
    assert.equal(search.matches[0].file, "server.js");
    const { sessionId } = text(await call("fxmind_start_task", { kind: "fix", ui: true }));
    await call("fxmind_record_gate", { gate: "A", sessionId, note: "Only the server implementation changed; no interface impact." });
    await call("fxmind_record_gate", { gate: "B", sessionId });
    assert.equal((await call("fxmind_record_gate", { gate: "V", sessionId, note: "Everything is fine" })).isError, true);
    execFileSync(process.execPath, ["--check", path.join(root, "server.js")]);
    const verified = text(await call("fxmind_record_gate", { gate: "V", sessionId, evidence }));
    assert.equal(verified.gates.V.complete, true);
    fs.writeFileSync(path.join(root, "server.js"), "module.exports = 'changed';");
    assert.equal((await call("fxmind_record_gate", { gate: "C", sessionId })).isError, true);
  });
});

// The reviewer here refutes whatever it is shown: Gate V passing proves it was never asked.
it("Gate V asks no reviewer for a trivial task or one non-Lua file outside fix/mechanic/create", async () => {
  await withServer("refuted", async (call) => {
    const trivial = text(await call("fxmind_start_task", { kind: "fix", trivial: true }));
    const passed = text(await call("fxmind_record_gate", { gate: "V", sessionId: trivial.sessionId, evidence }));
    assert.equal(passed.gates.V.complete, true);
    assert.equal(passed.gates.V.evidence.independentReview, undefined);
    await call("fxmind_record_gate", { gate: "C", sessionId: trivial.sessionId });

    const refactor = text(await call("fxmind_start_task", { kind: "refactor" }));
    await call("fxmind_record_gate", { gate: "A", sessionId: refactor.sessionId, note: "One server file, no interface impact." });
    await call("fxmind_record_gate", { gate: "B", sessionId: refactor.sessionId });
    assert.equal(text(await call("fxmind_record_gate", { gate: "V", sessionId: refactor.sessionId, evidence })).gates.V.complete, true);
  });
});

it("Gate V still asks the reviewer for a fix, and a refuted review blocks it", async () => {
  await withServer("refuted", async (call) => {
    const { sessionId } = text(await call("fxmind_start_task", { kind: "fix" }));
    await call("fxmind_record_gate", { gate: "A", sessionId, note: "One server file, no interface impact." });
    await call("fxmind_record_gate", { gate: "B", sessionId });
    const blocked = await call("fxmind_record_gate", { gate: "V", sessionId, evidence });
    assert.match(blocked.content[0].text, /gate_v_review_failed/);
  });
});
