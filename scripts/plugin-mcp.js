#!/usr/bin/env node
"use strict";

/**
 * Local Agent Plugin entry point. Keep the MCP runtime scoped to an explicitly
 * selected project; plugin managers launch stdio servers from the plugin root.
 */
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const PLUGIN_ROOT = path.resolve(__dirname, "..");
const REQUIRED_MODULES = ["mysql2", "sharp", "@aws-sdk/client-s3", "dotenv"];

function projectRoot(env = process.env) {
  const selected = env.FXMIND_TARGET || env.CLAUDE_PROJECT_DIR;
  if (!selected) {
    throw new Error(
      "FXMIND_TARGET is missing. Select a project root in the plugin MCP environment " +
      "(Claude Code also supports CLAUDE_PROJECT_DIR). Never use the plugin directory as memory.",
    );
  }
  const root = path.resolve(selected);
  if (root === PLUGIN_ROOT) {
    throw new Error("FXMIND_TARGET must be the target project, not the plugin installation.");
  }
  if (!fs.existsSync(path.join(root, ".fxmind", "packs.json"))) {
    throw new Error(
      "No .fxmind/packs.json in the selected project. Run fxmind --agent <client> -y " +
      "in that project before starting the plugin MCP.",
    );
  }
  return root;
}

function hasRuntimeDependencies(serverPath) {
  if (!fs.existsSync(serverPath)) return false;
  return REQUIRED_MODULES.every((name) => {
    try {
      require.resolve(name, { paths: [path.dirname(serverPath)] });
      return true;
    } catch {
      return false;
    }
  });
}

function runtimeCandidates(env = process.env) {
  const candidates = [path.join(PLUGIN_ROOT, "scripts", "mcp-server.js")];
  if (env.APPDATA) {
    candidates.push(path.join(env.APPDATA, "npm", "node_modules", "fxmind", "scripts", "mcp-server.js"));
  }
  if (env.npm_config_prefix) {
    candidates.push(path.join(env.npm_config_prefix, "node_modules", "fxmind", "scripts", "mcp-server.js"));
    candidates.push(path.join(env.npm_config_prefix, "lib", "node_modules", "fxmind", "scripts", "mcp-server.js"));
  }
  candidates.push("/usr/local/lib/node_modules/fxmind/scripts/mcp-server.js");
  candidates.push("/opt/homebrew/lib/node_modules/fxmind/scripts/mcp-server.js");
  try {
    const pkg = require.resolve("fxmind/package.json");
    candidates.push(path.join(path.dirname(pkg), "scripts", "mcp-server.js"));
  } catch {
    // Global installs normally do not participate in Node module resolution.
  }
  return [...new Set(candidates)];
}

function runtimeVersion(serverPath) {
  try {
    const pkg = path.join(path.dirname(serverPath), "..", "package.json");
    return JSON.parse(fs.readFileSync(pkg, "utf8")).version || null;
  } catch {
    return null;
  }
}

function expectedRuntimeVersion() {
  for (const pkg of ["package.json", "plugin.json"]) {
    try {
      const version = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, pkg), "utf8")).version;
      if (version) return version;
    } catch {
      // Packaged plugins may contain only plugin.json.
    }
  }
  return null;
}

function selectRuntime(env = process.env) {
  const expected = expectedRuntimeVersion();
  // Never silently substitute a different global version: it changes the
  // MCP tool catalog and makes hosts disagree on the number of tools.
  return runtimeCandidates(env).find((candidate) =>
    hasRuntimeDependencies(candidate) &&
    (!expected || runtimeVersion(candidate) === expected)) || null;
}

function main() {
  try {
    const target = projectRoot(process.env);
    const runtime = selectRuntime(process.env);
    if (!runtime) {
      throw new Error(
        "FXMIND MCP runtime missing, dependencies absent, or version does not match plugin (" +
        (expectedRuntimeVersion() || "unknown") + "). " +
        "Run npm ci in this checkout, or update both the plugin and global FXMIND to the same version.",
      );
    }
    const child = spawn(process.execPath, [runtime], {
      cwd: target,
      env: { ...process.env, FXMIND_TARGET: target },
      stdio: "inherit",
      windowsHide: true,
    });
    child.on("error", (error) => {
      process.stderr.write("[fxmind-plugin] " + error.message + "\n");
      process.exitCode = 1;
    });
    child.on("exit", (code) => { process.exitCode = code ?? 1; });
    for (const signal of ["SIGINT", "SIGTERM"]) {
      process.on(signal, () => { if (!child.killed) child.kill(signal); });
    }
  } catch (error) {
    process.stderr.write("[fxmind-plugin] " + error.message + "\n");
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  projectRoot,
  hasRuntimeDependencies,
  runtimeCandidates,
  selectRuntime,
};
