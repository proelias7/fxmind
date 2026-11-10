"use strict";
const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const packs = require("./packs");
const { resolvePackSkillsDir, usesRemoteSkillsCache, listSkillsInDir } = require("./resolve-packs");
const { installSharedFxmind } = require("./install/shared");
const review = require("./lib/independent-review");
const tools = require("./fxmind-tools");

let root;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), "fxpacks-")); });
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

function write(rel, body = "") {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), body);
}

describe("pack detection", () => {
  it("picks web for a web project and FiveM when a resource manifest exists", () => {
    write("package.json", "{}");
    assert.deepEqual(packs.detectPackIds(root), ["web"]);
    write("resources/[core]/garages/fxmanifest.lua");
    // A FiveM server carries package.json in NUI folders; FiveM wins.
    assert.deepEqual(packs.detectPackIds(root), ["fivem"]);
  });

  it("falls back to FiveM when nothing is detectable", () => {
    assert.deepEqual(packs.detectPackIds(root), []);
    assert.deepEqual(packs.getDefaultPackIds(root), ["fivem"]);
  });
});

describe("web pack", () => {
  it("ships its skills inside the package, with no remote cache", () => {
    const dir = resolvePackSkillsDir("web", { packs: ["web"] });
    assert.equal(dir, path.join(packs.PACKS_DIR, "web", "skills"));
    assert.equal(usesRemoteSkillsCache("web", { packs: ["web"] }), false);
    const skills = listSkillsInDir(dir);
    for (const name of packs.getPack("web").defaultSkills) assert.ok(skills.includes(name), name);
  });

  it("every review, correction and template path it declares exists", () => {
    const pack = packs.getPack("web");
    const skillsDir = path.join(packs.PACKS_DIR, "web", "skills");
    const policy = new Set(pack.templateFiles.map((t) => t.dest));
    const review = pack.review;
    const entries = [...review.policy, ...review.always, ...review.rules.flatMap((r) => r.files)]
      .map((e) => (typeof e === "string" ? e : e.file));
    for (const file of entries) {
      if (file.startsWith("skills/")) assert.ok(fs.existsSync(path.join(skillsDir, file.slice(7))), file);
      else assert.ok(policy.has(file), file);
    }
    for (const target of Object.values(pack.correctionTargets)) {
      assert.ok(fs.existsSync(path.join(skillsDir, target)), target);
    }
    for (const { src } of pack.templateFiles) assert.ok(fs.existsSync(path.join(pack.templatesDir, src)), src);
  });

  it("installs web policy and routes the reviewer and corrections to web skills", () => {
    installSharedFxmind(root, ["web"], {});
    assert.ok(fs.existsSync(path.join(root, ".fxmind", "policy", "web-principles.md")));
    assert.match(fs.readFileSync(path.join(root, ".fxmind", "audits", "procedure.md"), "utf8"), /Audit procedure — Web pack/);
    // Reviewer reads skills from .fxmind/skills; copy the bundled ones there.
    fs.cpSync(path.join(packs.PACKS_DIR, "web", "skills"), path.join(root, ".fxmind", "skills"), { recursive: true });
    const backend = review.reviewGuidance(root, ["src/server/orders/route.ts"]);
    assert.match(backend, /web-principles\.md/);
    assert.match(backend, /web-backend\/database\.md/);
    assert.doesNotMatch(backend, /fivem/i);
    const ui = review.reviewGuidance(root, ["src/components/OrderForm.tsx"]);
    assert.match(ui, /web-frontend\/accessibility\.md/);
    tools.recordCorrection(root, { title: "Validate the body with a schema", category: "security" });
    const dir = path.join(root, ".fxmind", "corrections");
    const file = fs.readdirSync(dir).find((name) => name.includes("validate-the-body"));
    assert.match(fs.readFileSync(path.join(dir, file), "utf8"), /skill_target: web-development\/security\.md/);
  });
});

describe("multiple packs", () => {
  it("concatenates shared policy files instead of letting the last pack win", () => {
    installSharedFxmind(root, ["fivem", "web"], {});
    const routing = fs.readFileSync(path.join(root, ".fxmind", "policy", "domain-routing.md"), "utf8");
    assert.match(routing, /# Domain routing — FiveM/);
    assert.match(routing, /# Domain routing — Web/);
    assert.ok(fs.existsSync(path.join(root, ".fxmind", "policy", "fivem-principles.md")));
    assert.ok(fs.existsSync(path.join(root, ".fxmind", "policy", "web-principles.md")));
    assert.deepEqual(packs.installedPackIds(root), ["fivem", "web"]);
  });
});
