const { it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

// GLOBAL_ROOT is fixed when the module loads, so each scenario runs in a child with its own HOME.
function inChild(home, script) {
  const run = spawnSync(process.execPath, ["-e", script], {
    cwd: path.join(__dirname, ".."), encoding: "utf8",
    env: { ...process.env, HOME: home, USERPROFILE: home },
  });
  assert.equal(run.status, 0, run.stderr);
  return JSON.parse(run.stdout.trim().split("\n").pop());
}

function setup() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "fxglobal-"));
  const home = path.join(base, "home");
  const project = path.join(base, "project");
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(path.join(project, ".fxmind"), { recursive: true });
  return { base, home, project };
}

it("linking a real .fxmind folder keeps its files when the global folder already exists", () => {
  const { base, home, project } = setup();
  try {
    // First setup creates the global folders and links.
    inChild(home, `const s=require("./scripts/global-store");s.setupGlobalStore(${JSON.stringify(project)});console.log("{}")`);
    // A pull (or another tool) brings back a real folder with files the global one lacks, and one that differs.
    const local = path.join(project, ".fxmind", "corrections");
    fs.rmSync(local, { recursive: true, force: true });
    fs.mkdirSync(local, { recursive: true });
    fs.writeFileSync(path.join(local, "new-fix.md"), "from git\n");
    const result = inChild(home, `const s=require("./scripts/global-store");const r=s.setupGlobalStore(${JSON.stringify(project)});console.log(JSON.stringify(r.merged))`);
    assert.equal(result.copied, 1);
    assert.equal(fs.lstatSync(local).isSymbolicLink(), true, "the folder is a link again");
    assert.equal(fs.readFileSync(path.join(local, "new-fix.md"), "utf8"), "from git\n", "the file survived the relink");

    // A differing file is kept beside the global one, never overwritten.
    fs.rmSync(local, { recursive: true, force: true });
    fs.mkdirSync(local, { recursive: true });
    fs.writeFileSync(path.join(local, "new-fix.md"), "edited elsewhere\n");
    const second = inChild(home, `const s=require("./scripts/global-store");const r=s.setupGlobalStore(${JSON.stringify(project)});console.log(JSON.stringify(r.merged))`);
    assert.equal(second.conflicts.length, 1);
    assert.match(second.conflicts[0], /^new-fix\.local-.+\.md$/);
    assert.equal(fs.readFileSync(path.join(local, "new-fix.md"), "utf8"), "from git\n");
    assert.equal(fs.readFileSync(path.join(local, second.conflicts[0]), "utf8"), "edited elsewhere\n");
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

it("Claude Code may read the global store without asking: additionalDirectories in settings.local.json", () => {
  const { base, home, project } = setup();
  try {
    fs.mkdirSync(path.join(project, ".claude"), { recursive: true });
    fs.writeFileSync(path.join(project, ".claude", "settings.local.json"), JSON.stringify({ permissions: { allow: ["Bash(ls)"] } }));
    const out = inChild(home, `const s=require("./scripts/global-store");const p=${JSON.stringify(project)};const r=s.setupGlobalStore(p);
      const before=s.claudeStoreAccessMissing(p);const first=s.ensureClaudeStoreAccess(p);const again=s.ensureClaudeStoreAccess(p);
      console.log(JSON.stringify({before,first,again,after:s.claudeStoreAccessMissing(p),dir:r.globalProjectDir}))`);
    assert.equal(out.before, true);
    assert.equal(out.first, true);
    assert.equal(out.again, false, "idempotent");
    assert.equal(out.after, false);
    const settings = JSON.parse(fs.readFileSync(path.join(project, ".claude", "settings.local.json"), "utf8"));
    assert.deepEqual(settings.permissions.allow, ["Bash(ls)"], "other settings are kept");
    assert.ok(settings.permissions.additionalDirectories.includes(path.resolve(out.dir).replace(/\\/g, "/")));
    assert.equal(settings.permissions.additionalDirectories.length, 2, "project folder and shared skills");
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});
