const { it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const readline = require("readline");
const { spawn, execFileSync } = require("child_process");

/** Runs `use(call, root)` against a real MCP server over stdio, its reviewer answering `reviewer`. */
async function withServer(reviewer, use, env = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fxmcp-verify-"));
  fs.writeFileSync(path.join(root, "server.js"), "module.exports = 'save';");
  const child = spawn(process.execPath, [path.join(__dirname, "mcp-server.js")], {
    cwd: root, env: { ...process.env, NODE_ENV: "test", FXMIND_TARGET: root, FXMIND_SESSION_ID: "", FXMIND_AGENT_ID: "codex", FXMIND_TEST_REVIEWER_RESULT: reviewer, ...env },
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

const { TOOL_DEFS } = require("./mcp-server");
const text = (result) => JSON.parse(result.content[0].text);

it("Gate V is not advertised to any coding agent", () => {
  const record=TOOL_DEFS.find(tool=>tool.name==="fxmind_record_gate");
  assert.deepEqual(record.inputSchema.properties.gate.enum,["START","A","B","C"]);
  assert.doesNotMatch(record.description,/automatic.*review|Gate V/i);
  assert.ok(TOOL_DEFS.some(tool=>tool.name==="fxmind_independent_review"),"optional reviewer is still available");
});

it("MCP completes a task after A and B; stale V is a successful no-op",async()=>{
 await withServer("refuted",async(call,root)=>{
  const started=text(await call("fxmind_start_task",{kind:"fix"}));
  const sessionId=started.sessionId;
  const premature=await call("fxmind_record_gate",{gate:"C",sessionId});
  assert.equal(premature.isError,true);
  await call("fxmind_record_gate",{gate:"A",sessionId,note:"Current behavior and regression check"});
  await call("fxmind_record_gate",{gate:"B",sessionId});
  const old=text(await call("fxmind_record_gate",{gate:"V",sessionId}));
  assert.equal(old.removed,true);
  assert.equal(old.ok,true);
  assert.equal(fs.existsSync(path.join(root,".fxmind","state","gate-v-pending.json")),false);
  const done=text(await call("fxmind_record_gate",{gate:"C",sessionId}));
  assert.equal(done.ok,true);
  assert.equal(done.taskActive,false);
  assert.equal(done.gates.C.complete,true);
  assert.equal(done.gates.V,undefined);
 });
});

it("old pending marker never triggers a review, question, or injected reply",async()=>{
 await withServer("refuted",async(call,root)=>{
  const dir=path.join(root,".fxmind","state");
  fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(path.join(dir,"gate-v-ask.json"),JSON.stringify({ask:true,at:new Date().toISOString()}));
  const {sessionId}=text(await call("fxmind_start_task",{kind:"fix"}));
  await call("fxmind_record_gate",{gate:"A",sessionId});
  await call("fxmind_record_gate",{gate:"B",sessionId});
  const old=text(await call("fxmind_record_gate",{gate:"V",sessionId}));
  assert.equal(old.removed,true);
  assert.equal(fs.existsSync(path.join(dir,"gate-v-pending.json")),false);
  assert.equal(fs.existsSync(path.join(dir,"gate-v-choice.json")),false);
  assert.equal(fs.existsSync(path.join(dir,"reviews")),false);
  const completed=text(await call("fxmind_record_gate",{gate:"C",sessionId}));
  assert.equal(completed.taskActive,false);
 },{FXMIND_AGENT_ID:"claude"});
});

it("trivial task closes without additional mandatory quality gates",async()=>{
 await withServer("refuted",async(call)=>{
  const session=text(await call("fxmind_start_task",{trivial:true,note:"single-line fix"}));
  assert.equal(session.gates.A.complete,true);
  assert.equal(session.gates.B.complete,true);
  const done=text(await call("fxmind_record_gate",{gate:"C",sessionId:session.sessionId}));
  assert.equal(done.gates.C.complete,true);
 });
});

it("Gate C releases file claims so another session can continue",async()=>{
 await withServer("refuted",async(call)=>{
  const first=text(await call("fxmind_start_task",{trivial:true,note:"first"}));
  const second=text(await call("fxmind_start_task",{trivial:true,note:"second"}));
  const name="server.js";
  assert.equal(text(await call("fxmind_claim_paths",{sessionId:first.sessionId,paths:[name]})).ok,true);
  const conflict=text(await call("fxmind_claim_paths",{sessionId:second.sessionId,paths:[name]}));
  assert.equal(conflict.ok,false);
  assert.equal(conflict.error,"path_conflict");
  const completed=text(await call("fxmind_record_gate",{gate:"C",sessionId:first.sessionId}));
  assert.equal(completed.taskActive,false);
  assert.equal(text(await call("fxmind_claim_paths",{sessionId:second.sessionId,paths:[name]})).ok,true);
 });
});
