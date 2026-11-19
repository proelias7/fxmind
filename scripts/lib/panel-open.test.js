"use strict";
const { describe, it }=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const { parseOpenArgs, openPanel }=require("./panel-open");

describe("panel-open starts the dashboard before launching a browser",()=>{
  it("requires a real project path and a valid local port",()=>{
    assert.throws(()=>parseOpenArgs(["--cwd",path.join(os.tmpdir(),"missing-fxmind-dashboard-"+Date.now())]),/Projeto não encontrado/);
    assert.throws(()=>parseOpenArgs(["--port","99"]),/Porta inválida/);
    assert.throws(()=>parseOpenArgs(["--anything"]),/Argumento desconhecido/);
  });
  it("reuses a healthy server without spawning another, attaches current project and launches browser",async()=>{
    const events=[];
    const result=await openPanel(["--cwd",os.tmpdir(),"--port","3860"],{
      healthy:async()=>true,
      attach:async(port,root)=>{events.push(["attach",port,root]);return {workspaceRoot:root}},
      spawn:()=>{throw Error("must not spawn")},
      browser:(port,url)=>events.push(["browser",port,url]),
    });
    assert.equal(result.started,false);
    assert.deepEqual(events.map(x=>x[0]),["attach","browser"]);
    assert.equal(events[1][2],"/");
  });
  it("spawns detached Node server, confirms health, attaches project and opens browser in that order",async()=>{
    const events=[];
    let checks=0;
    const result=await openPanel(["--cwd",os.tmpdir(),"--port","3861"],{
      healthy:async()=>{checks++;return checks>=3},
      attach:async(port,root)=>{events.push("attach");return {workspaceRoot:root}},
      browser:()=>events.push("browser"),
      spawn:(bin,args,opts)=>{
        events.push("spawn");
        assert.equal(bin,process.execPath);
        assert.ok(args.some(x=>x==="--cwd"));
        assert.equal(opts.stdio,"ignore");
        assert.equal(opts.detached,true);
        return {exitCode:null,unref(){}};
      },
    });
    assert.equal(result.started,true);
    assert.deepEqual(events,["spawn","attach","browser"]);
  });
  it("does not open a dead link on error or failed workspace attachment",async()=>{
    let calls=0;
    await assert.rejects(openPanel(["--cwd",os.tmpdir()],{
      healthy:async()=>true,
      attach:async()=>null,
      browser:()=>{calls++},
    }),/não foi possível selecionar o projeto/);
    assert.equal(calls,0);
  });
  it("supports health checks without launching browser for test mode",async()=>{
    let browsers=0;
    const result=await openPanel(["--cwd",os.tmpdir(),"--no-open"],{
      healthy:async()=>true,
      attach:async(_,root)=>({workspaceRoot:root}),
      browser:()=>{browsers++},
    });
    assert.equal(result.ok,true);
    assert.equal(browsers,0);
  });
});

describe("a panel left running from before an update is replaced",()=>{
  const http=require("node:http");
  const { resolvePanelPort }=require("../serve");
  const fake=(build,onShutdown)=>new Promise(resolve=>{
    const server=http.createServer((req,res)=>{
      if(req.url==="/api/shutdown"){res.end("{}");onShutdown?.(server);return;}
      res.setHeader("Content-Type","application/json");
      res.end(JSON.stringify({service:"fxmind-panel",build}));
    });
    server.listen(0,"127.0.0.1",()=>resolve(server));
  });
  it("shuts a stale server down and serves on the same port",async()=>{
    const stale=await fake("old",s=>{s.close();s.closeAllConnections()});
    const port=stale.address().port;
    const chosen=await resolvePanelPort(port);
    assert.deepEqual(chosen,{port,reuse:false});
  });
  it("moves to the next port when a stale server cannot be stopped",async()=>{
    const stale=await fake("old");
    const port=stale.address().port;
    const chosen=await resolvePanelPort(port);
    stale.close();stale.closeAllConnections();
    assert.equal(chosen.reuse,false);
    assert.ok(chosen.port>port&&chosen.port<=port+9);
  });
  it("reuses a server that already runs this build",async()=>{
    const { BUILD_ID }=require("../serve");
    const current=await fake(BUILD_ID);
    const port=current.address().port;
    const chosen=await resolvePanelPort(port);
    current.close();current.closeAllConnections();
    assert.deepEqual(chosen,{port,reuse:true});
  });
});
