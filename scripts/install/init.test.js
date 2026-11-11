"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { installSharedFxmind } = require("./shared");
const { installCommand, installFxmindAgentSkill, resolveAgents } = require("./agents");

test("installs Init and compatible aliases for each client while preserving learned project files", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fxmind-init-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, ".fxmind", "memory"), { recursive: true });
  const reference = path.join(root, ".fxmind", "reference.md");
  const memory = path.join(root, ".fxmind", "memory", "orders.md");
  fs.writeFileSync(reference, "Existing project map\n");
  fs.writeFileSync(memory, "Existing learned facts\n");
  installSharedFxmind(root, ["web"], { preserveUserData: true });
  for (const agent of resolveAgents(["cursor", "claude", "codex", "gemini", "copilot", "opencode"])) {
    installCommand(root, agent);
    installFxmindAgentSkill(root, agent);
  }
  for (const file of [".fxmind/fxmind.md", ".cursor/commands/fxmind.md", ".claude/commands/fxmind.md", ".github/prompts/fxmind.prompt.md", ".opencode/commands/fxmind.md", ".agents/skills/fxmind/SKILL.md"]) {
    assert.match(fs.readFileSync(path.join(root, file), "utf8"), /\.fxmind\/modes\/init\.md/);
  }
  for (const file of [".gemini/commands/fxmind/init.toml", ".gemini/commands/fxmind/reference.toml", ".fxmind/modes/reference.md"]) {
    assert.match(fs.readFileSync(path.join(root, file), "utf8"), /\.fxmind\/modes\/init\.md/);
  }
  assert.equal(fs.readFileSync(reference, "utf8"), "Existing project map\n");
  assert.equal(fs.readFileSync(memory, "utf8"), "Existing learned facts\n");
});
