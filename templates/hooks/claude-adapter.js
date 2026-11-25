#!/usr/bin/env node
/**
 * fxmind claude-adapter — runs the Cursor hook scripts beside it for Claude Code
 * and translates their output to Claude's hook protocol.
 *
 *   node .claude/hooks/claude-adapter.js pre   PreToolUse  → gate-guard.js (Gates A/B, path claims)
 *   node .claude/hooks/claude-adapter.js post  PostToolUse → drift-watcher.js (stale memories)
 *   node .claude/hooks/claude-adapter.js prompt UserPromptSubmit → `fxmind context --hook`
 *     (memory/playbook preload), run as node + the located CLI so it works
 *     when npm's global bin folder is not on PATH (common on Windows).
 *
 * An allow prints nothing, so Claude's own permission rules still apply.
 * Fail-open: any error → no output, exit 0.
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const SCRIPTS = { pre: "gate-guard.js", post: "drift-watcher.js" };

/** Claude's answer for a Cursor hook result, or null for "say nothing". */
function translate(event, cursor, input = {}) {
  if (!cursor || typeof cursor !== "object") return null;
  if (event === "pre") {
    if (cursor.permission !== "ask" && cursor.permission !== "deny") return null;
    // deny, not ask: an approved prompt would let the edit skip the gates.
    return { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny",
      permissionDecisionReason: cursor.agent_message || cursor.user_message || "fxmind gate" } };
  }
  if (event === "post") {
    return cursor.additional_context
      ? { hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: cursor.additional_context } }
      : null;
  }
  return null;
}

/** UserPromptSubmit: forwards to `fxmind context --hook`; its output is already Claude's format. */
function prompt(raw, root) {
  const { fxmindCommand } = require("./lib/fxmind-cli.js");
  const cmd = fxmindCommand(["context", "--hook"]);
  const run = spawnSync(cmd.command, cmd.args, {
    cwd: root, input: raw, encoding: "utf8", timeout: 9000, maxBuffer: 8 * 1024 * 1024,
    shell: cmd.shell, windowsHide: true,
  });
  if (run.status === 0 && run.stdout) process.stdout.write(run.stdout);
}

function main() {
  const event = process.argv[2];
  if (event === "prompt") {
    const raw = fs.readFileSync(0, "utf8");
    let input = {};
    try { input = raw ? JSON.parse(raw) : {}; } catch { return; }
    return prompt(raw, process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd());
  }
  const script = SCRIPTS[event];
  if (!script) return;
  const raw = fs.readFileSync(0, "utf8");
  let input = {};
  try { input = raw ? JSON.parse(raw) : {}; } catch { return; }
  const root = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
  const run = spawnSync(process.execPath, [path.join(__dirname, script)], {
    cwd: root, input: raw, encoding: "utf8", timeout: 12000, maxBuffer: 8 * 1024 * 1024,
  });
  let cursor = null;
  try { cursor = JSON.parse(run.stdout || "null"); } catch { return; }
  const out = translate(event, cursor, input);
  if (out) process.stdout.write(JSON.stringify(out));
}

if (require.main === module) {
  try { main(); } catch { /* fail-open */ }
  process.exitCode = 0;
}

module.exports = { translate, SCRIPTS };
