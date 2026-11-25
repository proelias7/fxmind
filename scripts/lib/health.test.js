const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const health = require("./health");

function write(root, rel, content) {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, "utf8");
}

const memory = (slug, paths) => `---
topic: ${slug}
updated: 2026-11-01
lang: en-compact
paths: [${paths.join(", ")}]
triggers: [${slug}]
---

# ${slug}

Files:
- config: \`${paths[0] || "none"}\`
`;

const PLAYBOOK = `---
id: add-box
kind: config
triggers: [cadastrar caixa]
status: draft
---
Steps:
1. \`resources/[old]/boxes/shared/config.lua\` @ \`Boxes = {\` — add the entry

Verify:
- ensure boxes
`;

describe("fxmind health", () => {
  let root;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "fxhealth-"));
    execFileSync("git", ["init", "-q", root]);
    write(root, ".fxmind/packs.json", JSON.stringify({ packs: [] }));
    // The resource moved from [old] to [ecco]: memory and playbook still point at [old].
    write(root, "resources/[ecco]/boxes/shared/config.lua", "Boxes = {\n}\n");
    write(root, "resources/[ecco]/boxes/fxmanifest.lua", "fx_version 'cerulean'\n");
    write(root, ".fxmind/memory/boxes.md", memory("boxes", ["resources/[old]/boxes/shared/config.lua", "resources/[old]/boxes/fxmanifest.lua"]));
    write(root, ".fxmind/playbooks/add-box.md", PLAYBOOK);
  });

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it("reports moved paths as fixable without writing anything", () => {
    const before = fs.readFileSync(path.join(root, ".fxmind/memory/boxes.md"), "utf8");
    const result = health.runHealth(root);
    assert.equal(result.ok, false);
    const messages = result.items.filter((i) => i.status === "fixable").map((i) => i.message).join("\n");
    assert.match(messages, /boxes: resources\/\[old\]\/boxes\/shared\/config\.lua moved to resources\/\[ecco\]\/boxes\/shared\/config\.lua/);
    assert.match(messages, /add-box: resources\/\[old\]\/boxes\/shared\/config\.lua moved/);
    assert.equal(fs.readFileSync(path.join(root, ".fxmind/memory/boxes.md"), "utf8"), before);
  });

  it("--fix relocates memory and playbook paths, rebuilds the graph and ends healthy", () => {
    const fixed = health.runHealth(root, { fix: true });
    assert.ok(fixed.fixed >= 3, JSON.stringify(fixed.items));
    const text = fs.readFileSync(path.join(root, ".fxmind/memory/boxes.md"), "utf8");
    assert.doesNotMatch(text, /\[old\]/);
    assert.match(text, /`resources\/\[ecco\]\/boxes\/shared\/config\.lua`/, "body references move too");
    assert.match(fs.readFileSync(path.join(root, ".fxmind/playbooks/add-box.md"), "utf8"), /resources\/\[ecco\]\/boxes\/shared\/config\.lua/);
    const again = health.runHealth(root);
    assert.equal(again.ok, true, JSON.stringify(again.items));
  });

  it("leaves ambiguous moves and changed anchors to the agent, with the command", () => {
    write(root, "resources/[copy]/boxes/fxmanifest.lua", "fx_version 'cerulean'\n");
    write(root, "resources/[ecco]/boxes/shared/config.lua", "Config = {}\n"); // anchor `Boxes = {` is gone
    const result = health.runHealth(root, { fix: true });
    const warns = result.items.filter((i) => i.status === "warn");
    assert.ok(warns.some((w) => /several candidates/.test(w.message) && /memory health boxes fix/.test(w.hint)), JSON.stringify(warns));
    assert.ok(warns.some((w) => /anchor not found/.test(w.message) && w.hint === "/fxmind teach add-box"), JSON.stringify(warns));
    assert.equal(result.ok, false);
  });

  it("flags memories without paths and files that no longer exist anywhere", () => {
    write(root, ".fxmind/memory/notes.md", memory("notes", []));
    write(root, ".fxmind/memory/gone.md", memory("gone", ["resources/[old]/radio/client.lua"]));
    const result = health.runHealth(root, { fix: true });
    const warns = result.items.filter((i) => i.status === "warn").map((i) => i.message).join("\n");
    assert.match(warns, /1 memory has empty paths\[\]/);
    assert.match(warns, /gone: resources\/\[old\]\/radio\/client\.lua no longer exists/);
  });

  it("replaces the legacy Claude prompt hook", () => {
    write(root, ".claude/settings.json", JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: [{ type: "command", command: "fxmind context --hook" }] }] } }));
    assert.equal(health.runHealth(root).items.find((i) => i.area === "setup").status, "fixable");
    health.runHealth(root, { fix: true });
    const settings = JSON.parse(fs.readFileSync(path.join(root, ".claude/settings.json"), "utf8"));
    const commands = settings.hooks.UserPromptSubmit.flatMap((g) => g.hooks.map((h) => h.command));
    assert.deepEqual(commands, [require("../prompt-context").CLAUDE_HOOK_COMMAND]);
    assert.ok(fs.existsSync(path.join(root, ".claude/hooks/lib/fxmind-cli.js")));
    assert.equal(health.runHealth(root).items.find((i) => i.area === "setup").status, "ok");
  });

  it("relocates a folder path and needs folder + name to match", () => {
    assert.deepEqual(health.relocate("resources/[old]/boxes/shared/", { files: [], dirs: ["resources/[ecco]/boxes/shared", "resources/[ecco]/boxes"] }),
      { to: "resources/[ecco]/boxes/shared/" });
    // A bare file name is never enough: fxmanifest.lua exists in every resource.
    assert.deepEqual(health.relocate("fxmanifest.lua", { files: ["a/fxmanifest.lua"], dirs: [] }), {});
  });

  it("CLI prints a report and exits 1 while something is left", () => {
    const run = require("child_process").spawnSync(process.execPath, [path.join(__dirname, "..", "install.js"), "health", "--target", root], {
      encoding: "utf8", env: { ...process.env, FXMIND_NO_UPDATE_CHECK: "1" },
    });
    assert.equal(run.status, 1, run.stderr);
    assert.match(run.stdout, /fxmind health —/);
    assert.match(run.stdout, /fixable with `fxmind health --fix`/);
  });
});
