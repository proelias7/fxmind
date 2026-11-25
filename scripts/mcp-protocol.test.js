const { it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const readline = require("readline");
const { spawn } = require("child_process");

/** Starts the server, writes raw lines, returns every reply until stdout closes. */
function exchange(rawLines, { closeInput = true, timeoutMs = 10000 } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fxmcp-proto-"));
  const child = spawn(process.execPath, [path.join(__dirname, "mcp-server.js")], {
    cwd: root, env: { ...process.env, NODE_ENV: "test", FXMIND_TARGET: root },
    stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
  });
  const replies = [];
  readline.createInterface({ input: child.stdout }).on("line", (line) => replies.push(JSON.parse(line)));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error("MCP timeout")); }, timeoutMs);
    child.on("exit", (code) => { clearTimeout(timer); resolve({ code, replies }); });
    for (const line of rawLines) child.stdin.write(`${line}\n`);
    if (closeInput) child.stdin.end();
  });
}

it("answers ping with an empty result", async () => {
  const { replies } = await exchange([JSON.stringify({ jsonrpc: "2.0", id: 7, method: "ping" })]);
  assert.deepEqual(replies, [{ jsonrpc: "2.0", id: 7, result: {} }]);
});

it("answers unparseable input with a JSON-RPC parse error", async () => {
  const { replies } = await exchange(["{not json"]);
  assert.equal(replies.length, 1);
  assert.equal(replies[0].id, null);
  assert.equal(replies[0].error.code, -32700);
});

it("answers a call still in flight when stdin closes", async () => {
  const { code, replies } = await exchange([
    JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "fxmind_panel_pending", arguments: {} } }),
  ]);
  assert.equal(code, 0);
  assert.equal(replies.length, 1);
  assert.equal(replies[0].id, 1);
  assert.ok(replies[0].result, "a tool result, not a dropped call");
});
