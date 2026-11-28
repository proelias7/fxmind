const { it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const readline = require("readline");
const { spawn } = require("child_process");

/** Starts the server, writes raw lines, returns every reply until stdout closes. */
function exchange(rawLines, { closeInput = true, timeoutMs = 10000, root = fs.mkdtempSync(path.join(os.tmpdir(), "fxmcp-proto-")) } = {}) {
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

/** Interactive client: call(method, params) resolves with the reply for that id. */
function startClient() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fxmcp-task-"));
  const child = spawn(process.execPath, [path.join(__dirname, "mcp-server.js")], {
    cwd: root, env: { ...process.env, NODE_ENV: "test", FXMIND_TARGET: root },
    stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
  });
  const waiting = new Map();
  let nextId = 100;
  readline.createInterface({ input: child.stdout }).on("line", (line) => {
    const msg = JSON.parse(line);
    waiting.get(msg.id)?.(msg);
    waiting.delete(msg.id);
  });
  return {
    call(method, params = {}) {
      const id = nextId++;
      return new Promise((resolve) => {
        waiting.set(id, resolve);
        child.stdin.write(`${rpc(id, method, params)}\n`);
      });
    },
    close: () => new Promise((resolve) => { child.on("exit", resolve); child.stdin.end(); }),
  };
}

const TASK_META = {
  ...MODERN_META,
  "io.modelcontextprotocol/clientCapabilities": { extensions: { "io.modelcontextprotocol/tasks": {} } },
};

it("server/discover advertises the tasks extension", async () => {
  const { replies } = await exchange([rpc(1, "server/discover", { _meta: MODERN_META })]);
  assert.deepEqual(replies[0].result.capabilities.extensions["io.modelcontextprotocol/tasks"], {});
});

it("runs a long tool as a task and returns its result through tasks/get", async () => {
  const client = startClient();
  try {
    const created = await client.call("tools/call", {
      name: "fxmind_independent_review", arguments: {}, _meta: TASK_META,
    });
    const task = created.result;
    assert.equal(task.resultType, "task");
    assert.equal(task.status, "working");
    assert.match(task.taskId, /^[0-9a-f-]{36}$/);
    assert.ok(task.createdAt && task.lastUpdatedAt && task.ttlMs > 0 && task.pollIntervalMs > 0);

    let got;
    for (let i = 0; i < 50; i++) {
      got = (await client.call("tasks/get", { taskId: task.taskId, _meta: TASK_META })).result;
      if (got.status !== "working") break;
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.equal(got.resultType, "complete");
    assert.equal(got.status, "completed");
    // No active session: the tool reports an error, which is still a completed task.
    assert.equal(got.result.isError, true);
    assert.match(got.result.content[0].text, /no_active_session/);
    assert.equal(got.pollIntervalMs, undefined);
  } finally {
    await client.close();
  }
});

it("cancelling a working task makes it terminal and drops the late result", () => {
  const { cancelTask, taskView } = require("./mcp-server.js")._tasks;
  const task = { taskId: "t", status: "working", createdAt: "x", lastUpdatedAt: "x", result: null, orchestrationId: null };
  cancelTask(task);
  assert.equal(task.status, "cancelled");
  const view = taskView(task, { withOutcome: true });
  assert.equal(view.pollIntervalMs, undefined);
  assert.equal(view.result, undefined);
  cancelTask(task); // idempotent
  assert.equal(task.status, "cancelled");
});

it("tasks/cancel on a finished task is acknowledged and leaves it completed", async () => {
  const client = startClient();
  try {
    const { result: task } = await client.call("tools/call", {
      name: "fxmind_independent_review", arguments: {}, _meta: TASK_META,
    });
    let got;
    for (let i = 0; i < 50; i++) {
      got = (await client.call("tasks/get", { taskId: task.taskId, _meta: TASK_META })).result;
      if (got.status !== "working") break;
      await new Promise((r) => setTimeout(r, 20));
    }
    const cancelled = await client.call("tasks/cancel", { taskId: task.taskId, _meta: TASK_META });
    assert.equal(cancelled.result.resultType, "complete");
    got = (await client.call("tasks/get", { taskId: task.taskId, _meta: TASK_META })).result;
    assert.equal(got.status, "completed");
  } finally {
    await client.close();
  }
});

it("rejects task methods without the capability or with an unknown id", async () => {
  const { replies } = await exchange([
    rpc(1, "tasks/get", { taskId: "x", _meta: MODERN_META }),
    rpc(2, "tasks/get", { taskId: "missing", _meta: TASK_META }),
    rpc(3, "tasks/get", { taskId: "x" }),
  ]);
  const byId = Object.fromEntries(replies.map((r) => [r.id, r.error]));
  assert.equal(byId[1].code, -32021);
  assert.equal(byId[2].code, -32602);
  assert.equal(byId[3].code, -32021);
});

it("answers task-eligible tools synchronously when the client lacks the extension", async () => {
  const { replies } = await exchange([
    rpc(1, "tools/call", { name: "fxmind_independent_review", arguments: {}, _meta: MODERN_META }),
  ]);
  assert.equal(replies[0].result.resultType, "complete");
  assert.ok(Array.isArray(replies[0].result.content));
});

function projectWithSkills() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fxmcp-skills-"));
  const dir = path.join(root, ".fxmind", "skills", "demo-skill");
  fs.mkdirSync(path.join(dir, "refs"), { recursive: true });
  fs.writeFileSync(path.join(dir, "SKILL.md"), "---\nname: demo-skill\ndescription: >\n  Demo skill\n  for tests.\n---\n# Demo\nSee [api](refs/api.md).\n");
  fs.writeFileSync(path.join(dir, "refs", "api.md"), "# API\n");
  // Frontmatter name that does not match its folder is not served.
  const bad = path.join(root, ".fxmind", "skills", "bad");
  fs.mkdirSync(bad, { recursive: true });
  fs.writeFileSync(path.join(bad, "SKILL.md"), "---\nname: other\ndescription: x\n---\n");
  fs.writeFileSync(path.join(root, ".fxmind", "secret.txt"), "nope");
  return root;
}

it("server/discover advertises resources and the skills extension", async () => {
  const { replies } = await exchange([rpc(1, "server/discover", { _meta: MODERN_META })]);
  const caps = replies[0].result.capabilities;
  assert.ok(caps.resources);
  assert.ok(caps.extensions["io.modelcontextprotocol/skills"]);
});

it("serves installed skills through skills/list, skills/get and resources/read", async () => {
  const crypto = require("crypto");
  const root = projectWithSkills();
  const { replies } = await exchange([
    rpc(1, "skills/list", { _meta: MODERN_META }),
    rpc(2, "skills/get", { uri: "skill://fxmind/demo-skill/SKILL.md", _meta: MODERN_META }),
    rpc(3, "resources/read", { uri: "skill://fxmind/demo-skill/refs/api.md", _meta: MODERN_META }),
    rpc(4, "resources/list", { _meta: MODERN_META }),
  ], { root });
  const byId = Object.fromEntries(replies.map((r) => [r.id, r]));

  const { skills } = byId[1].result;
  assert.equal(byId[1].result.resultType, "complete");
  assert.deepEqual(skills.map((s) => s.frontmatter.name), ["demo-skill"]);
  assert.equal(skills[0].frontmatter.description, "Demo skill for tests.");
  assert.deepEqual(skills[0].resources.map((r) => r.uri), [
    "skill://fxmind/demo-skill/SKILL.md",
    "skill://fxmind/demo-skill/refs/api.md",
  ]);
  const apiEntry = skills[0].resources[1];
  assert.equal(apiEntry.size, 6);
  assert.equal(apiEntry.digest, `sha256:${crypto.createHash("sha256").update("# API\n").digest("hex")}`);

  assert.equal(byId[2].result.skill.uri, "skill://fxmind/demo-skill/SKILL.md");
  assert.deepEqual(byId[3].result.contents, [
    { uri: "skill://fxmind/demo-skill/refs/api.md", mimeType: "text/markdown", text: "# API\n" },
  ]);
  assert.equal(byId[4].result.resources[0].uri, "skill://fxmind/demo-skill/SKILL.md");
});

it("rejects unknown skills and paths outside a skill (-32602)", async () => {
  const root = projectWithSkills();
  const { replies } = await exchange([
    rpc(1, "skills/get", { uri: "skill://fxmind/missing/SKILL.md", _meta: MODERN_META }),
    rpc(2, "resources/read", { uri: "skill://fxmind/demo-skill/../../secret.txt", _meta: MODERN_META }),
    rpc(3, "resources/read", { uri: "skill://fxmind/demo-skill/%2e%2e/%2e%2e/secret.txt", _meta: MODERN_META }),
    rpc(4, "skills/get", { uri: "skill://fxmind/bad/SKILL.md", _meta: MODERN_META }),
  ], { root });
  assert.deepEqual(replies.map((r) => r.error?.code), [-32602, -32602, -32602, -32602]);
});

const ELICIT_META = {
  ...MODERN_META,
  "io.modelcontextprotocol/clientCapabilities": { elicitation: {} },
};
const DELETE_ARGS = { query: "DELETE FROM users WHERE id = 1", approvedByUser: true };

it("asks the user before destructive SQL instead of trusting approvedByUser", async () => {
  const { replies } = await exchange([
    rpc(1, "tools/call", { name: "fxmind_db_query", arguments: DELETE_ARGS, _meta: ELICIT_META }),
  ]);
  const { result } = replies[0];
  assert.equal(result.resultType, "input_required");
  assert.equal(result.inputRequests.confirm.method, "elicitation/create");
  assert.equal(result.inputRequests.confirm.params.mode, "form");
  assert.match(result.inputRequests.confirm.params.message, /DELETE FROM users/);
  assert.equal(typeof result.requestState, "string");
});

it("runs, refuses or re-asks according to the user's answer", async () => {
  const client = startClient();
  try {
    const call = (extra) => client.call("tools/call", {
      name: "fxmind_db_query", arguments: DELETE_ARGS, _meta: ELICIT_META, ...extra,
    });
    const asked = (await call({})).result;

    const declined = (await call({ requestState: asked.requestState, inputResponses: { confirm: { action: "decline" } } })).result;
    assert.equal(declined.isError, true);
    assert.match(declined.content[0].text, /user_declined/);

    const tampered = (await call({ requestState: `${asked.requestState}x`, inputResponses: { confirm: { action: "accept", content: { confirm: true } } } })).result;
    assert.equal(tampered.resultType, "input_required");

    const accepted = (await call({ requestState: asked.requestState, inputResponses: { confirm: { action: "accept", content: { confirm: true } } } })).result;
    assert.equal(accepted.resultType, "complete");
    // Past the approval gate: no database here, so it fails later, not with needsApproval.
    assert.doesNotMatch(accepted.content[0].text, /needsApproval/);

    const replayed = (await call({ requestState: asked.requestState, inputResponses: { confirm: { action: "accept", content: { confirm: true } } } })).result;
    assert.equal(replayed.resultType, "input_required", "a requestState is single-use");
  } finally {
    await client.close();
  }
});

it("keeps the approvedByUser flow for clients without elicitation", async () => {
  const { replies } = await exchange([
    rpc(1, "tools/call", { name: "fxmind_db_query", arguments: { query: "DELETE FROM users" }, _meta: MODERN_META }),
  ]);
  assert.equal(replies[0].result.resultType, "complete");
  assert.match(replies[0].result.content[0].text, /needsApproval/);
});
