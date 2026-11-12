/**
 * Computer use through the accessibility tree with agent-desktop
 * (github.com/vercel-labs/agent-desktop, Apache-2.0), for the desktop_observe
 * and desktop_act tools. Ported from the Portspace Agent
 * (internal/ops/desktop.go, desktop_windows.go).
 *
 * A pinned release is downloaded on first use into ~/.fxmind/tools, its archive
 * and exe SHA-256 are checked (the exe again on every use), and one command
 * runs per call without a shell. Flags that write files, switch the ref
 * namespace or bypass agent-desktop's own guards are refused.
 */

const crypto = require("crypto");
const fs = require("fs");
const https = require("https");
const os = require("os");
const path = require("path");
const zlib = require("zlib");
const { spawn } = require("child_process");

const VERSION = "1.1.0";
const MAX_ARGS = 48;
const MAX_ARG_BYTES = 16 << 10;
const MAX_STDIN_BYTES = 64 << 10;
const MAX_OUTPUT_BYTES = 1 << 20;
const MAX_STDERR_BYTES = 8 << 10;
const MAX_ARCHIVE_BYTES = 64 << 20;
const DEFAULT_TIMEOUT = 30_000;
const MAX_TIMEOUT = 120_000;
const RELEASE_URL = `https://github.com/vercel-labs/agent-desktop/releases/download/v${VERSION}/`;

// Official hashes of the v1.1.0 release (checksums.txt) and of the exe inside.
const BUILDS = {
  x64: {
    archive: `agent-desktop-v${VERSION}-x86_64-pc-windows-msvc.tar.gz`,
    archiveSHA: "5c13b932add079c141da18631d65b1680d1b9bcb73942f2f99146c9ee13877f6",
    exeSHA: "2c8e9a627d87649a4562bfe5678450d045b793ab6f3fdec8af05c9571f32d5ef",
  },
  arm64: {
    archive: `agent-desktop-v${VERSION}-aarch64-pc-windows-msvc.tar.gz`,
    archiveSHA: "20e2a2a029bc7e86aaacf2003afa78708d66e4cb51f3c216597e1f5d79d496bf",
    exeSHA: "bb8eb196e8ee8292617b15995561a85d51a0207b6c150eddb4ee3004310e3378",
  },
};

const OBSERVE_COMMANDS = new Set([
  "snapshot", "find", "get", "is", "list-surfaces", "list-apps", "list-windows", "list-displays",
  "list-notifications", "clipboard-get", "wait", "status", "version", "skills",
]);

const ACT_COMMANDS = new Set([
  "click", "double-click", "triple-click", "right-click", "type", "set-value", "clear", "focus", "select",
  "toggle", "check", "uncheck", "expand", "collapse", "scroll", "scroll-to", "press", "hover", "drag",
  "mouse-move", "mouse-click", "mouse-wheel", "launch", "close-app", "focus-window", "resize-window",
  "move-window", "minimize", "maximize", "restore", "open-system-surface", "dismiss-notification",
  "dismiss-all-notifications", "notification-action", "clipboard-set", "clipboard-clear", "batch",
]);

// Write sensitive files (screenshot/debug/trace), expose a debug port (cdp),
// switch the ref namespace (session/agent-id) or unlock blocked system
// shortcuts (force). --headed comes only from the parameter.
const DENIED_FLAGS = new Set([
  "--force", "--screenshot", "--debug", "--trace", "--trace-strict", "--cdp", "--session", "--agent-id", "--headed",
]);
const DENIED_BATCH_KEYS = new Set([
  "force", "screenshot", "debug", "trace", "trace_strict", "cdp", "session", "agent_id", "headed",
]);
const STDIN_COMMANDS = new Set(["type", "set-value", "clipboard-set"]);

class DesktopError extends Error {}

function dataDir() {
  return process.env.FXMIND_AGENT_DESKTOP_DIR || path.join(os.homedir(), ".fxmind");
}

/** Validates a request and returns the final argv (without the exe). */
function desktopArgv(params, act) {
  const p = {
    command: String(params.command ?? "").trim(),
    args: params.args ?? [],
    headed: params.headed === true,
    stdin: typeof params.stdin === "string" ? params.stdin : "",
    timeoutMs: params.timeoutMs ?? DEFAULT_TIMEOUT,
  };
  // The act tool also accepts the read commands, e.g. list-notifications --headed.
  if (!OBSERVE_COMMANDS.has(p.command) && !(act && ACT_COMMANDS.has(p.command))) {
    if (ACT_COMMANDS.has(p.command)) throw new DesktopError(`command "${p.command}" changes the desktop: use desktop_act`);
    throw new DesktopError(`desktop command not allowed: "${p.command}"`);
  }
  if (p.headed && !act) throw new DesktopError("headed only applies to actions");
  if (!Array.isArray(p.args) || p.args.some((arg) => typeof arg !== "string")) throw new DesktopError("args must be a list of strings");
  if (p.args.length > MAX_ARGS) throw new DesktopError(`at most ${MAX_ARGS} arguments`);
  if (!Number.isInteger(p.timeoutMs) || p.timeoutMs < 1000 || p.timeoutMs > MAX_TIMEOUT) {
    throw new DesktopError(`timeoutMs must be between 1000 and ${MAX_TIMEOUT}`);
  }
  if (Buffer.byteLength(p.stdin) > MAX_STDIN_BYTES) throw new DesktopError("stdin is too large");
  if (p.stdin && !STDIN_COMMANDS.has(p.command)) throw new DesktopError("stdin only applies to type, set-value and clipboard-set");
  p.args.forEach((arg, i) => {
    if (Buffer.byteLength(arg) > MAX_ARG_BYTES) throw new DesktopError(`argument ${i} is too large`);
    if (arg.includes("\0")) throw new DesktopError(`argument ${i} is invalid`);
    let flag = arg.toLowerCase();
    const eq = flag.indexOf("=");
    if (eq > 0) flag = flag.slice(0, eq);
    if (DENIED_FLAGS.has(flag)) throw new DesktopError(`flag ${flag} is not allowed by fxmind`);
    if (flag === "--stdin") throw new DesktopError("use the stdin parameter instead of --stdin");
  });
  if (p.command === "batch") checkBatch(p.args);
  const argv = [p.command, ...p.args];
  if (p.stdin) argv.push("--stdin");
  if (p.headed) argv.push("--headed");
  return { argv, params: p };
}

/** Every batch entry follows the same rules: known commands, no denied keys. */
function checkBatch(args) {
  let payload = "";
  for (const arg of args) {
    if (!arg.startsWith("-")) {
      if (payload) throw new DesktopError("batch takes a single JSON");
      payload = arg;
    }
  }
  if (!payload) throw new DesktopError("batch needs the JSON of its entries");
  let entries;
  try {
    entries = JSON.parse(payload);
  } catch (error) {
    throw new DesktopError(`invalid batch JSON: ${error.message}`);
  }
  if (!Array.isArray(entries) || entries.length === 0 || entries.length > 32) {
    throw new DesktopError("batch must have 1 to 32 entries");
  }
  entries.forEach((entry, i) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry) || typeof entry.command !== "string") {
      throw new DesktopError(`entry ${i} has no command`);
    }
    const command = entry.command;
    if (command === "batch" || command === "skills" || (!OBSERVE_COMMANDS.has(command) && !ACT_COMMANDS.has(command))) {
      throw new DesktopError(`entry ${i}: command "${command}" is not allowed in a batch`);
    }
    for (const key of Object.keys(entry)) {
      if (key !== "command" && key !== "args") throw new DesktopError(`entry ${i}: field "${key}" is not allowed`);
    }
    if (entry.args !== undefined && entry.args !== null) {
      if (typeof entry.args !== "object" || Array.isArray(entry.args)) throw new DesktopError(`entry ${i}: args must be an object`);
      for (const key of Object.keys(entry.args)) {
        if (DENIED_BATCH_KEYS.has(key.toLowerCase())) throw new DesktopError(`entry ${i}: argument "${key}" is not allowed`);
      }
    }
  });
}

/**
 * Returns agent-desktop's JSON envelope. Its own errors (ok:false) are returned
 * as a value: the agent needs error.code and disposition to decide on a retry.
 */
function parseEnvelope(stdout) {
  const text = String(stdout).trim();
  if (!text) throw new DesktopError("agent-desktop did not answer");
  let envelope;
  try {
    envelope = JSON.parse(text);
  } catch (error) {
    // Some commands may print more than one line; use the last one.
    const lines = text.split("\n");
    try {
      envelope = JSON.parse(lines[lines.length - 1].trim());
    } catch {
      throw new DesktopError(`unexpected agent-desktop output: ${error.message}`);
    }
  }
  if (!envelope || typeof envelope !== "object" || !("ok" in envelope)) {
    throw new DesktopError("unexpected agent-desktop output (no ok field)");
  }
  return envelope;
}

// ---- pinned binary ----

const sha256 = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");

function fileSHA(file) {
  try {
    return sha256(fs.readFileSync(file));
  } catch {
    return "";
  }
}

function download(url, deadline, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new DesktopError("download: too many redirects"));
    const request = https.get(url, { headers: { "User-Agent": "fxmind" } }, (response) => {
      const { statusCode, headers } = response;
      if (statusCode >= 300 && statusCode < 400 && headers.location) {
        response.resume();
        resolve(download(new URL(headers.location, url).toString(), deadline, redirects + 1));
        return;
      }
      if (statusCode !== 200) {
        response.resume();
        reject(new DesktopError(`download: HTTP ${statusCode}`));
        return;
      }
      const chunks = [];
      let size = 0;
      response.on("data", (chunk) => {
        size += chunk.length;
        if (size > MAX_ARCHIVE_BYTES) {
          request.destroy(new DesktopError("download: archive is too large"));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => resolve(Buffer.concat(chunks)));
      response.on("error", reject);
    });
    request.setTimeout(Math.max(1000, deadline - Date.now()), () => request.destroy(new DesktopError("download: timed out")));
    request.on("error", (error) => reject(error instanceof DesktopError ? error : new DesktopError(`download: ${error.message}`)));
  });
}

/** Finds agent-desktop.exe in a .tar.gz (ustar and GNU long names). */
function extractExe(archive) {
  const tar = zlib.gunzipSync(archive, { maxOutputLength: MAX_ARCHIVE_BYTES * 2 });
  let offset = 0;
  let longName = null;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const field = (start, length) => header.subarray(start, start + length).toString("utf8").replace(/\0.*$/s, "");
    const size = parseInt(field(124, 12).trim() || "0", 8);
    const type = String.fromCharCode(header[156] || 48);
    const prefix = field(345, 155);
    const name = longName || (prefix ? `${prefix}/${field(0, 100)}` : field(0, 100));
    const body = tar.subarray(offset + 512, offset + 512 + size);
    longName = null;
    if (type === "L") {
      longName = body.toString("utf8").replace(/\0.*$/s, "");
    } else if ((type === "0" || type === "\0") && path.posix.basename(name.replace(/\\/g, "/")) === "agent-desktop.exe") {
      return Buffer.from(body);
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  throw new DesktopError("agent-desktop.exe missing from the archive");
}

let installing = null;

/** Ensures the pinned exe in ~/.fxmind/tools/agent-desktop/<version>/. */
function binary() {
  const build = BUILDS[process.arch];
  if (!build) return Promise.reject(new DesktopError(`no agent-desktop build for ${process.arch}`));
  const dir = path.join(dataDir(), "tools", "agent-desktop", VERSION);
  const exe = path.join(dir, "agent-desktop.exe");
  if (fileSHA(exe) === build.exeSHA) return Promise.resolve(exe);
  if (!installing) {
    installing = (async () => {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      const archive = await download(RELEASE_URL + build.archive, Date.now() + 120_000);
      if (sha256(archive) !== build.archiveSHA) throw new DesktopError("agent-desktop archive SHA-256 does not match");
      const content = extractExe(archive);
      if (sha256(content) !== build.exeSHA) throw new DesktopError("agent-desktop.exe SHA-256 does not match");
      const tmp = `${exe}.tmp`;
      fs.writeFileSync(tmp, content, { mode: 0o700 });
      fs.rmSync(exe, { force: true });
      try {
        fs.renameSync(tmp, exe);
      } catch (error) {
        fs.rmSync(tmp, { force: true });
        throw error;
      }
      return exe;
    })().finally(() => { installing = null; });
  }
  return installing;
}

// ---- run ----

function execute(exe, argv, p) {
  return new Promise((resolve, reject) => {
    const home = dataDir();
    const child = spawn(exe, argv, {
      cwd: home,
      env: { ...process.env, AGENT_DESKTOP_HOME: path.join(home, "agent-desktop-state") },
      windowsHide: true,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    let outBytes = 0;
    let errBytes = 0;
    let truncated = false;
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, p.timeoutMs);
    child.stdout.on("data", (chunk) => {
      const room = MAX_OUTPUT_BYTES - outBytes;
      if (chunk.length > room) truncated = true;
      if (room > 0) {
        stdout.push(chunk.subarray(0, room));
        outBytes += Math.min(room, chunk.length);
      }
    });
    child.stderr.on("data", (chunk) => {
      const room = MAX_STDERR_BYTES - errBytes;
      if (room > 0) {
        stderr.push(chunk.subarray(0, room));
        errBytes += Math.min(room, chunk.length);
      }
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(new DesktopError(`agent-desktop failed to start: ${error.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) return reject(new DesktopError(`agent-desktop exceeded ${p.timeoutMs} ms`));
      if (truncated) {
        return reject(new DesktopError("agent-desktop output passed 1 MB: narrow it with -i, --compact, --skeleton, --root or --max-depth"));
      }
      try {
        resolve(parseEnvelope(Buffer.concat(stdout).toString("utf8")));
      } catch (error) {
        const detail = Buffer.concat(stderr).toString("utf8").trim();
        reject(code !== 0 && detail ? new DesktopError(`${error.message}: ${detail}`) : error);
      }
    });
    if (p.stdin) child.stdin.end(p.stdin);
    else child.stdin.end();
  });
}

/** Runs one agent-desktop command (act=false: read-only commands only). */
async function run(params, act) {
  const { argv, params: p } = desktopArgv(params, act);
  let exe;
  try {
    exe = await binary();
  } catch (error) {
    throw new DesktopError(`agent-desktop unavailable: ${error.message}`);
  }
  return execute(exe, argv, p);
}

module.exports = {
  VERSION,
  BUILDS,
  DesktopError,
  desktopArgv,
  checkBatch,
  parseEnvelope,
  extractExe,
  run,
};
