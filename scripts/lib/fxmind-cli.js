/**
 * Locates the installed fxmind CLI for hooks copied into a project
 * (.claude/hooks, .cursor/hooks), without relying on `fxmind` being on PATH.
 *
 * npm's global bin folder is often missing from PATH on Windows
 * (%APPDATA%\npm), so a hook command such as `fxmind context --hook` fails
 * silently there. Hooks run `node <install.js> ...` instead, found here.
 *
 * Order: FXMIND_BIN (explicit command) → FXMIND_CLI (path to install.js) →
 * the known global install folders → the folders on PATH → plain `fxmind`.
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const CLI_REL = path.join("fxmind", "scripts", "install.js");

function packageRoots(env = process.env, execPath = process.execPath, platform = process.platform) {
  const roots = [];
  const add = (dir) => { if (dir) roots.push(dir); };
  const home = env.HOME || env.USERPROFILE || os.homedir();
  // Windows npm default prefix and the nodejs folder (node_modules beside node.exe).
  if (env.APPDATA) add(path.join(env.APPDATA, "npm", "node_modules"));
  add(path.join(path.dirname(execPath), "node_modules"));
  // POSIX default prefix: <prefix>/bin/node → <prefix>/lib/node_modules.
  add(path.join(path.dirname(execPath), "..", "lib", "node_modules"));
  for (const prefix of [env.npm_config_prefix, env.NPM_CONFIG_PREFIX, home && path.join(home, ".fxmind", "npm"), home && path.join(home, ".npm-global")]) {
    if (!prefix) continue;
    add(path.join(prefix, "node_modules"));
    add(path.join(prefix, "lib", "node_modules"));
  }
  if (env.NVM_SYMLINK) add(path.join(env.NVM_SYMLINK, "node_modules"));
  // Any bin folder on PATH: Windows keeps node_modules beside it, POSIX one level up.
  const sep = platform === "win32" ? ";" : ":";
  for (const dir of String(env.PATH || env.Path || "").split(sep).filter(Boolean)) {
    if (/[\\/]_npx[\\/]/i.test(`${dir}/`)) continue; // npx's temporary cache is gone later
    add(path.join(dir, "node_modules"));
    add(path.join(dir, "..", "lib", "node_modules"));
  }
  return [...new Set(roots.map((root) => path.resolve(root)))];
}

/** Absolute path of fxmind's scripts/install.js, or null. */
function locateCli(env = process.env, execPath = process.execPath, platform = process.platform) {
  if (env.FXMIND_CLI && fs.existsSync(env.FXMIND_CLI)) return path.resolve(env.FXMIND_CLI);
  for (const root of packageRoots(env, execPath, platform)) {
    const candidate = path.join(root, CLI_REL);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * How to run `fxmind <args>`: { command, args, shell }. Prefers node + the
 * located install.js; falls back to the `fxmind` command through a shell.
 */
function fxmindCommand(args, env = process.env, execPath = process.execPath, platform = process.platform) {
  if (env.FXMIND_BIN) return { command: env.FXMIND_BIN, args, shell: true };
  const cli = locateCli(env, execPath, platform);
  if (cli) return { command: execPath, args: [cli, ...args], shell: false };
  return { command: "fxmind", args, shell: true };
}

module.exports = { locateCli, fxmindCommand, packageRoots };
