"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { setTimeout: delay } = require("node:timers/promises");
const { isPanelUp, attachWorkspace, openBrowser, DEFAULT_PORT } = require("../serve");

function parseOpenArgs(argv = []) {
  const out = { root: process.cwd(), port: DEFAULT_PORT, open: true };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === "--cwd" && argv[i+1]) out.root = argv[++i];
    else if (flag === "--port" && argv[i+1]) out.port = Number(argv[++i]);
    else if (flag === "--no-open") out.open = false;
    else if (flag === "--open") out.open = true;
    else throw new Error("Argumento desconhecido: " + flag);
  }
  if (!Number.isInteger(out.port) || out.port < 1024 || out.port > 65535) throw new Error("Porta inválida");
  out.root = path.resolve(out.root);
  if (!fs.existsSync(out.root) || !fs.statSync(out.root).isDirectory()) {
    throw new Error("Projeto não encontrado: " + out.root);
  }
  return out;
}

/**
 * Short-lived, click-driven panel opener. A detached child owns the web server,
 * while this command returns to Claude after verifying the local FXMIND API.
 * Browser opens only AFTER health succeeds, never to a dead localhost URL.
 */
async function openPanel(argv = [], dependencies = {}) {
  const opts = parseOpenArgs(argv);
  const healthy = dependencies.healthy || isPanelUp;
  const attach = dependencies.attach || attachWorkspace;
  const launchBrowser = dependencies.browser || openBrowser;
  const spawnServer = dependencies.spawn || spawn;
  let started = false;
  if (!(await healthy(opts.port))) {
    const script = path.resolve(__dirname, "..", "serve.js");
    const child = spawnServer(process.execPath, [script, "--port", String(opts.port), "--cwd", opts.root], {
      cwd: opts.root,
      env: process.env,
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
    started = true;
    let up = false;
    for (let attempt=0; attempt<45; attempt++) {
      if (await healthy(opts.port)) { up = true; break; }
      if (child.exitCode !== null) break;
      await delay(160);
    }
    if (!up) throw new Error("Painel não iniciou. Verifique a porta " + opts.port + " ou execute fxmind painel.");
  }
  const attached = await attach(opts.port, opts.root);
  if (!attached || !attached.workspaceRoot) {
    throw new Error("Painel respondeu, mas não foi possível selecionar o projeto.");
  }
  if (opts.open) launchBrowser(opts.port, "/");
  return { ok: true, started, port: opts.port, root: attached.workspaceRoot };
}

async function runPanelOpen(argv = []) {
  try {
    const result = await openPanel(argv);
    console.log("FXMIND painel " + (result.started ? "iniciado" : "reutilizado") + " em http://127.0.0.1:" + result.port);
    return 0;
  } catch (error) {
    console.error("FXMIND painel: " + (error?.message || error));
    return 1;
  }
}

module.exports = { parseOpenArgs, openPanel, runPanelOpen };
