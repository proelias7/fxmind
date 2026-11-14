"use strict";

/**
 * One isolated, long-lived orchestration broker per project.
 * Both MCP stdio processes and the local HTTP panel use this same broker.
 * The broker owns the worker process tree; clients never execute subtasks.
 */
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const starts = new Map();

function normalizedRoot(projectRoot) {
  const value = path.resolve(String(projectRoot || process.cwd()));
  let real = value;
  try { real = fs.realpathSync.native(value); } catch { /* project may be created later */ }
  return process.platform === "win32" ? real.toLowerCase() : real;
}

function brokerSocket(projectRoot) {
  const digest = crypto.createHash("sha256").update(normalizedRoot(projectRoot)).digest("hex").slice(0, 32);
  if (process.platform === "win32") {
    return '\\\\.\\pipe\\fxmind-orch-v1-' + digest;
  }
  const dir = path.join(os.tmpdir(), 'fxmind-orch-' + String(process.getuid?.() ?? os.userInfo().username));
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return path.join(dir, digest + '.sock');
}

function requestRaw(projectRoot, endpoint, method = "GET", payload = null, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const body = payload === null ? null : JSON.stringify(payload);
    const req = http.request({
      socketPath: brokerSocket(projectRoot),
      path: endpoint,
      method,
      headers: body === null ? {} : {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        try {
          const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          if (res.statusCode >= 400) reject(new Error(data.error || 'Broker HTTP ' + res.statusCode));
          else resolve(data);
        } catch (err) {
          reject(err);
        }
      });
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error("Orchestration broker timeout")));
    req.on("error", reject);
    if (body !== null) req.write(body);
    req.end();
  });
}

async function ensureBroker(projectRoot) {
  const root = normalizedRoot(projectRoot);
  const socket = brokerSocket(root);
  if (starts.has(socket)) return starts.get(socket);

  const startup = (async () => {
    try {
      const current = await requestRaw(root, "/health", "GET", null, 1500);
      if (current.version === 1) return;
      throw new Error("Incompatible orchestration broker at " + socket);
    } catch (err) {
      if (!["ENOENT", "ECONNREFUSED", "EPIPE"].includes(err.code)) throw err;
    }

    const script = path.join(__dirname, "..", "orchestration-broker.js");
    const child = spawn(process.execPath, [script, root], {
      cwd: path.dirname(script),
      env: { ...process.env, FXMIND_TARGET: root },
      detached: true, windowsHide: true, stdio: "ignore",
    });
    child.once("error", () => {});
    child.unref();

    for (let i = 0; i < 60; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      try {
        const ping = await requestRaw(root, "/health", "GET", null, 300);
        if (ping.version === 1) return;
        throw new Error("Incompatible orchestration broker");
      } catch (err) {
        if (!["ENOENT", "ECONNREFUSED", "EPIPE"].includes(err.code)) throw err;
      }
    }
    throw new Error("Orchestration broker failed to start for " + root);
  })();
  starts.set(socket, startup);
  try { await startup; } finally { starts.delete(socket); }
}

async function brokerCall(projectRoot, action, payload = {}, timeoutMs = 300000) {
  await ensureBroker(projectRoot);
  return requestRaw(projectRoot, "/rpc", "POST", { action, ...payload }, Math.max(3000, timeoutMs));
}

/** Forward broker SSE to a browser without creating a second engine. */
async function forwardEvents(projectRoot, clientRes, orchestrationId = "") {
  await ensureBroker(projectRoot);
  const target = "/events" + (orchestrationId ? "?id=" + encodeURIComponent(orchestrationId) : "");
  return new Promise((resolve, reject) => {
    const req = http.get({ socketPath: brokerSocket(projectRoot), path: target }, (upstream) => {
      if (upstream.statusCode !== 200) {
        upstream.resume();
        reject(new Error("Orchestration event stream refused"));
        return;
      }
      clientRes.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      });
      upstream.pipe(clientRes);
      clientRes.on("close", () => {
        req.destroy();
        upstream.destroy();
      });
      resolve();
    });
    req.on("error", reject);
  });
}

module.exports = { brokerCall, brokerSocket, ensureBroker, forwardEvents, normalizedRoot };
