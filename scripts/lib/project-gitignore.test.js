"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { ensureProjectGitignore } = require("./project-gitignore");

describe("project .gitignore: only fxmind knowledge is shared", () => {
  it("keeps memory and corrections in git, drops installed fxmind files", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "fxmind-gitignore-"));
    const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
    git("init", "-q");
    const files = {
      ".fxmind/memory/atoms.json": "{}",
      ".fxmind/memory/vehicles.md": "# v",
      ".fxmind/corrections/2026-01-fix.md": "c",
      ".fxmind/corrections/README.md": "r",
      ".fxmind/corrections/correction.template.md": "t",
      ".fxmind/modes/task.md": "m",
      ".fxmind/policy/domain-routing.md": "p",
      ".fxmind/fxmind.md": "f",
      ".fxmind/packs.json": "{}",
      "opencode.json": "{}",
      ".claude/hooks/gate-guard.js": "g",
      ".claude/hooks/lib/layout.js": "l",
      ".claude/hooks/mine.js": "mine",
      ".claude/settings.json": "{}",
      ".cursor/rules/fxmind-auto-task.mdc": "r",
      ".opencode/agents/reviewer.md": "r",
      ".mcp.json": "{}",
      "dev/dev.cfg": "# Created by fxmind fivem install\nset rcon_password x\n",
      "src/a.lua": "x",
    };
    for (const [rel, body] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      fs.writeFileSync(path.join(root, rel), body);
    }
    git("add", "-A");

    ensureProjectGitignore(root);
    git("add", "-A");

    const tracked = git("ls-files").split("\n").filter(Boolean).sort();
    assert.deepEqual(tracked, [
      ".claude/hooks/mine.js",
      ".claude/settings.json",
      ".fxmind/corrections/2026-01-fix.md",
      ".fxmind/memory/atoms.json",
      ".fxmind/memory/vehicles.md",
      ".gitignore",
      ".mcp.json",
      "src/a.lua",
    ]);
  });
});

describe("project .gitignore: a team's own dev.cfg", () => {
  it("stays in git when fxmind did not write it", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "fxmind-devcfg-"));
    const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
    git("init", "-q");
    fs.mkdirSync(path.join(root, "dev"));
    fs.writeFileSync(path.join(root, "dev", "dev.cfg"), "ensure mine\n");
    git("add", "-A");
    ensureProjectGitignore(root);
    assert.match(git("ls-files"), /dev\/dev\.cfg/);
  });
});
