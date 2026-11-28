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

const MODERN_META = {
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientInfo": { name: "test", version: "1.0.0" },
  "io.modelcontextprotocol/clientCapabilities": {},
};
const rpc = (id, method, params = {}) => JSON.stringify({ jsonrpc: "2.0", id, method, params });

it("server/discover advertises 2026-07-28 with the modern result envelope", async () => {
  const { replies } = await exchange([rpc("d1", "server/discover", { _meta: MODERN_META })]);
  assert.equal(replies.length, 1);
  const { result } = replies[0];
  assert.equal(replies[0].id, "d1");
  assert.equal(result.resultType, "complete");
  assert.deepEqual(result.supportedVersions, ["2026-07-28"]);
  assert.ok(result.capabilities.tools);
  assert.equal(result._meta["io.modelcontextprotocol/serverInfo"].name, "fxmind");
  assert.equal(result.ttlMs, 0);
  assert.equal(result.cacheScope, "private");
});

it("rejects a modern request with an unsupported version (-32022)", async () => {
  const meta = { ...MODERN_META, "io.modelcontextprotocol/protocolVersion": "1900-01-01" };
  const { replies } = await exchange([rpc(2, "tools/list", { _meta: meta })]);
  assert.equal(replies[0].error.code, -32022);
  assert.equal(replies[0].error.data.requested, "1900-01-01");
  assert.ok(replies[0].error.data.supported.includes("2026-07-28"));
});

it("rejects modern requests missing required _meta fields (-32602)", async () => {
  const noCaps = { "io.modelcontextprotocol/protocolVersion": "2026-07-28" };
  const { replies } = await exchange([
    rpc(3, "server/discover"),
    rpc(4, "tools/list", { _meta: noCaps }),
  ]);
  assert.deepEqual(replies.map((r) => r.error?.code), [-32602, -32602]);
});

it("modern tools/list and tools/call carry resultType and serverInfo", async () => {
  const { replies } = await exchange([
    rpc(5, "tools/list", { _meta: MODERN_META }),
    rpc(6, "tools/call", { name: "fxmind_panel_pending", arguments: {}, _meta: MODERN_META }),
  ]);
  const byId = Object.fromEntries(replies.map((r) => [r.id, r.result]));
  assert.equal(byId[5].resultType, "complete");
  assert.ok(byId[5].tools.length > 0);
  assert.equal(byId[5].ttlMs, 0);
  assert.equal(byId[6].resultType, "complete");
  assert.equal(typeof byId[6].isError, "boolean");
  assert.equal(byId[6]._meta["io.modelcontextprotocol/serverInfo"].name, "fxmind");
});

it("legacy requests keep the legacy result shape", async () => {
  const { replies } = await exchange([rpc(7, "tools/list")]);
  assert.equal(replies[0].result.resultType, undefined);
  assert.equal(replies[0].result._meta, undefined);
});

it("initialize echoes a supported legacy version and falls back otherwise", async () => {
  const { replies } = await exchange([
    rpc(8, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } }),
    rpc(9, "initialize", { protocolVersion: "2099-01-01" }),
  ]);
  const byId = Object.fromEntries(replies.map((r) => [r.id, r.result]));
  assert.equal(byId[8].protocolVersion, "2025-06-18");
  assert.equal(byId[9].protocolVersion, "2025-11-25");
});

it("sends no response for a cancelled in-flight call", async () => {
  const { code, replies } = await exchange([
    rpc(10, "tools/call", { name: "fxmind_panel_pending", arguments: {} }),
    JSON.stringify({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 10, reason: "test" } }),
    rpc(11, "ping"),
  ]);
  assert.equal(code, 0);
  assert.deepEqual(replies.map((r) => r.id), [11]);
});
