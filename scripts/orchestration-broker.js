#!/usr/bin/env node
"use strict";

/**
 * Dedicated local orchestration owner. Launched on demand via named pipe /
 * Unix domain socket; no open TCP port, no second in-process engine.
 */
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { engine } = require("./lib/orchestration-engine");
const { brokerSocket, normalizedRoot } = require("./lib/orchestration-client");
const config = require("./lib/panel-orchestration");

const root = normalizedRoot(process.argv[2]);
const socket = brokerSocket(root);
let lastRequestAt = Date.now();
let listeners = 0;

function reply(res, data, code = 200) {
  const bytes = JSON.stringify(data);
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(bytes),
  });
  res.end(bytes);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString("utf8");
      if (body.length > 1024 * 1024) {
        req.destroy(new Error("Request too large"));
        reject(new Error("Request too large"));
      }
    });
    req.on("end", () => {
      try { resolve(JSON.parse(body || "{}")); }
      catch { reject(new Error("Invalid JSON")); }
    });
    req.on("error", reject);
  });
}

async function dispatch(message) {
  const id = String(message.id || "");
  switch (message.action) {
    case "test_shutdown":
      if (process.env.FXMIND_SYNTHETIC_ORCH !== "1") return { ok: false, error: "Not available" };
      setTimeout(() => {
        clearInterval(idleTimer);
        server.close();
        if (process.platform !== "win32") {
          try { fs.unlinkSync(socket); } catch { /* already gone */ }
        }
      }, 50);
      return { ok: true };
    case "config_get": return config.getOrchestrationSettings(root);
    case "config_set": return config.putOrchestrationSettings(root, {
      scope: message.scope || "project", config: message.config || {},
    });
    case "start": return engine.startOrchestration(message.plan || {}, {
      projectRoot: root, timeoutMs: message.timeoutMs,
      mode: message.mode, approved: message.approved,
    });
    case "status":
      if (id) {
        const orchestration = engine.getOrchestration(id, root);
        return orchestration ? { ok: true, orchestration } : { ok: false, error: "Orchestration not found" };
      }
      return { ok: true, orchestration: engine.getActiveOrchestration(root), recent: engine.listOrchestrations(5, root) };
    case "active": return { ok: true, orchestration: engine.getActiveOrchestration(root) };
    case "history": return { ok: true, orchestrations: engine.listOrchestrations(Math.min(100, Math.max(1, Number(message.limit) || 20)), root) };
    case "approve": return engine.approveOrchestration(id, root);
    case "cancel": return engine.cancelOrchestration(id, root);
    case "wait": return engine.waitForOrchestration(id, Math.min(900000, Number(message.timeoutMs) || 300000), root);
    default: return { ok: false, error: "Unknown orchestration action" };
  }
}

function eventStream(req, res) {
  const url = new URL(req.url, "http://localhost");
  const id = url.searchParams.get("id");
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
  });
  const send = (evt) => { if (!res.writableEnded) res.write("data: " + JSON.stringify(evt) + "\n\n"); };
  send({ type: "snapshot", orchestration: id
    ? engine.getOrchestration(id, root)
    : engine.getActiveOrchestration(root) });
  listeners++;
  const off = id
    ? engine.subscribe(id, send)
    : engine.subscribeAll(send);
  const ping = setInterval(() => { if (!res.writableEnded) res.write(": ping\n\n"); }, 12000);
  req.on("close", () => { off(); clearInterval(ping); listeners--; });
}

const server = http.createServer(async (req, res) => {
  lastRequestAt = Date.now();
  try {
    if (req.method === "GET" && req.url === "/health") {
      return reply(res, { ok: true, version: 1, projectRoot: root });
    }
    if (req.method === "GET" && req.url.startsWith("/events")) return eventStream(req, res);
    if (req.method !== "POST" || req.url !== "/rpc") return reply(res, { error: "Not found" }, 404);
    const message = await readJson(req);
    const result = await dispatch(message);
    return reply(res, result);
  } catch (err) {
    return reply(res, { ok: false, error: String(err.message || err) }, 500);
  }
});

if (process.platform !== "win32" && fs.existsSync(socket)) {
  // Only unlink stale sockets when no broker is listening. Normal starts are
  // race-safe: the losing process exits upon EADDRINUSE.
  const net = require("node:net");
  const probe = net.connect(socket);
  probe.once("connect", () => process.exit(0));
  probe.once("error", (err) => {
    if (err.code !== "ECONNREFUSED" && err.code !== "ENOENT") process.exit(1);
    try { fs.unlinkSync(socket); } catch { /* another process may own it */ }
    server.listen(socket);
  });
} else {
  server.listen(socket);
}
server.on("error", (err) => {
  if (err.code === "EADDRINUSE") process.exit(0);
  process.exit(1);
});
server.on("listening", () => {
  if (process.platform !== "win32") {
    try { fs.chmodSync(socket, 0o600); } catch { /* no-op */ }
  }
});
const idleTimer = setInterval(() => {
  const active = engine.getActiveOrchestration(root);
  if (listeners === 0 && active?.status !== "running" && Date.now() - lastRequestAt > 10 * 60 * 1000) {
    server.close();
    if (process.platform !== "win32") {
      try { fs.unlinkSync(socket); } catch { /* no-op */ }
    }
    clearInterval(idleTimer);
  }
}, 30000);
