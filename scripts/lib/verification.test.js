"use strict";
const { describe, it, beforeEach, afterEach }=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const {spawnSync}=require("node:child_process");
const verification=require("./verification");
const {startTask,recordGate,gateStatus}=require("../fxmind-tools");

describe("verification and task completion without a Gate V",()=>{
 let root,session;
 const checks=()=>[{
  kind:"test",target:"node --test",expected:"unit tests pass",observed:"exit 0",status:"passed"
 }];
 const evidence=(file="server.js")=>({
  files:[file],
  review:"Reviewed implementation, callers and error paths.",
  checks:checks(),
  ui:{changed:false,reason:"Backend-only change; no interaction or rendered output changed."}
 });
 const context=()=>({trivial:true,kind:"config",claimedPaths:[],ui:false});
 beforeEach(()=>{
  root=fs.mkdtempSync(path.join(os.tmpdir(),"fxverify-"));
  fs.writeFileSync(path.join(root,"server.js"),"module.exports=1;\n");
 });
 afterEach(()=>fs.rmSync(root,{recursive:true,force:true}));
 it("validates optional observed checks without any review-gate session",()=>{
  const result=verification.verify(root,evidence(),context());
  assert.equal(result.complete,true);
  assert.equal(result.evidence.checks[0].status,"passed");
  assert.ok(result.snapshot["server.js"]);
 });
 it("rejects invalid evidence instead of claiming unobserved checks",()=>{
  assert.throws(()=>verification.verify(root,{files:["server.js"]},context()),/requires (?:files|evidence)/);
  const e=evidence();e.checks[0].observed="";
  assert.throws(()=>verification.verify(root,e,context()),/Each verification check/);
 });
 it("reports a failed optional check without marking it complete",()=>{
  const e=evidence();e.checks[0].status="failed";
  assert.equal(verification.verify(root,e,context()).complete,false);
 });
 it("requires browser verification when the submitted evidence says UI changed",()=>{
  fs.writeFileSync(path.join(root,"App.tsx"),"export const App=()=> <button>Save</button>;");
  const e=evidence("App.tsx");
  e.ui={changed:true,reason:"Changed rendered button"};
  assert.throws(()=>verification.verify(root,e,context()),/browser evidence/);
 });
 it("rejects missing screenshots for UI changes and accepts a nonempty real artifact",()=>{
  const file="App.tsx";
  fs.writeFileSync(path.join(root,file),"export const App=()=> <button>Save</button>;");
  const e=evidence(file);
  e.ui={changed:true,reason:"Changed rendered button"};
  e.browser={status:"passed",url:"http://localhost/test",interactions:["clicked Save"],visual:"Save still visible",console:"no errors",artifact:"capture.png"};
  assert.throws(()=>verification.verify(root,e,context()),/ENOENT|no such file/);
  fs.writeFileSync(path.join(root,"capture.png"),Buffer.from([0x89,0x50,0x4e,0x47]));
  const verified=verification.verify(root,e,context());
  assert.equal(verified.complete,true);
 });
 it("preserves Task A/B ordering while allowing C directly after B",()=>{
  session=startTask(root,{kind:"fix"});
  assert.throws(()=>recordGate(root,"B",true,{sessionId:session.sessionId}),/requires Gate A/);
  assert.throws(()=>recordGate(root,"C",true,{sessionId:session.sessionId}),/requires Gate B/);
  recordGate(root,"A",true,{sessionId:session.sessionId});
  recordGate(root,"B",true,{sessionId:session.sessionId});
  const done=recordGate(root,"C",true,{sessionId:session.sessionId});
  assert.equal(done.taskActive,false);
  assert.equal(done.gates.V,undefined);
 });
 it("does not revive a review gate even when old instructions call it",()=>{
  session=startTask(root,{trivial:true});
  const result=recordGate(root,"V",true,{sessionId:session.sessionId,evidence:evidence()});
  assert.equal(result.removed,true);
  assert.equal(gateStatus(root,{sessionId:session.sessionId}).gates.V,undefined);
  assert.equal(recordGate(root,"C",true,{sessionId:session.sessionId}).taskActive,false);
 });
 it("hides historical V snapshots from session statuses without deleting stored task data",()=>{
  session=startTask(root,{trivial:true});
  const f=path.join(root,".fxmind","state","sessions",session.sessionId+".json");
  const raw=JSON.parse(fs.readFileSync(f,"utf8"));
  raw.gates.V={complete:true,note:"old reviewer"};
  fs.writeFileSync(f,JSON.stringify(raw));
  assert.equal(gateStatus(root,{sessionId:session.sessionId}).gates.V,undefined);
  assert.equal(JSON.parse(fs.readFileSync(f,"utf8")).gates.V.complete,true);
 });
 it("legacy Cursor stop hook never injects any followup message",()=>{
  session=startTask(root,{trivial:true});
  const hook=path.join(__dirname,"..","..","templates","hooks","learn-prompt.js");
  const result=spawnSync(process.execPath,[hook],{cwd:root,input:JSON.stringify({status:"completed",last_user_message:"continuar"}),encoding:"utf8",timeout:5000});
  assert.equal(result.status,0);
  assert.equal(result.stdout.trim(),"{}");
  assert.doesNotMatch(result.stdout,/followup_message|Gate V/);
 });
});
