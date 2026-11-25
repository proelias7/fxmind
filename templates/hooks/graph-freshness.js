#!/usr/bin/env node
/**
 * fxmind graph-freshness — Cursor sessionStart hook.
 * Rebuilds knowledge-graph.json + memory-index when memories are newer than the graph.
 * Removes stale .fxmind/tmp when no active mid-task scratch is needed.
 * Fail-open: any error → empty JSON.
 */
const { spawnSync } = require("child_process");
const { cleanupFxmindTmp } = require("./lib/cleanup-tmp.js");

const PROJECT_ROOT = process.cwd();

function respond(payload) {
  process.stdout.write(JSON.stringify(payload));
  process.exit(0);
}

function main() {
  try {
    cleanupFxmindTmp(PROJECT_ROOT);
  } catch {
    // fail-open
  }

  try {
    const disable =
      process.env.FXMIND_GRAPH_NO_AUTO &&
      process.env.FXMIND_GRAPH_NO_AUTO !== "0" &&
      process.env.FXMIND_GRAPH_NO_AUTO.toLowerCase() !== "false";
    if (disable) {
      respond({});
      return;
    }

    // node + the located CLI: `fxmind` is often not on PATH (Windows npm prefix).
    const cmd = require("./lib/fxmind-cli.js").fxmindCommand(["graph", "--no-open", "--no-html"]);
    spawnSync(cmd.command, cmd.args, {
      cwd: PROJECT_ROOT,
      timeout: 12000,
      stdio: "ignore",
      shell: cmd.shell,
      windowsHide: true,
    });
  } catch {
    // fail-open
  }
  respond({});
}

main();
