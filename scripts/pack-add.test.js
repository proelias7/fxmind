"use strict";
const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const { parseSource, validatePack, addPack, removePack, readSources } = require("./pack-add");
const packs = require("./packs");

const EXAMPLE = path.join(__dirname, "..", "examples", "packs", "hello");

let tmp;
let packsDir;
const savedEnv = process.env.FXMIND_PACKS_DIR;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fxpack-add-"));
  packsDir = path.join(tmp, "packs-home");
  process.env.FXMIND_PACKS_DIR = packsDir;
});
afterEach(() => {
  if (savedEnv === undefined) delete process.env.FXMIND_PACKS_DIR;
  else process.env.FXMIND_PACKS_DIR = savedEnv;
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** A copy of the example pack, changed by `edit`, in a folder of its own. */
function packCopy(edit = () => {}) {
  const dir = path.join(tmp, `pack-${Math.random().toString(36).slice(2)}`);
  fs.cpSync(EXAMPLE, dir, { recursive: true });
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, "pack.json"), "utf8"));
  edit(manifest, dir);
  fs.writeFileSync(path.join(dir, "pack.json"), JSON.stringify(manifest, null, 2));
  return dir;
}

function git(cwd, ...args) {
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], { cwd, stdio: "pipe" });
}

describe("pack source", () => {
  it("reads owner/repo as GitHub, keeps git URLs and finds local folders", () => {
    assert.deepEqual(parseSource("my-org/fxmind-pack-laravel"), {
      kind: "git", url: "https://github.com/my-org/fxmind-pack-laravel.git", label: "my-org/fxmind-pack-laravel",
    });
    assert.equal(parseSource("my-org/packs.git").url, "https://github.com/my-org/packs.git");
    assert.equal(parseSource("https://gitlab.com/a/b.git").url, "https://gitlab.com/a/b.git");
    assert.equal(parseSource("git@github.com:a/b.git").kind, "git");
    assert.deepEqual(parseSource(EXAMPLE), { kind: "local", dir: EXAMPLE, label: EXAMPLE });
    assert.throws(() => parseSource("not a source"), /Unknown pack source/);
    assert.throws(() => parseSource(""), /Missing pack source/);
  });
});

describe("pack validation", () => {
  it("accepts the documented example pack", () => {
    const { manifest, files } = validatePack(EXAMPLE);
    assert.equal(manifest.id, "hello");
    assert.deepEqual(files.sort(), ["pack.json", "skills/hello-basics/SKILL.md", "templates/domain-routing.md", "templates/hello-principles.md"]);
  });

  it("lists every problem of an invalid manifest", () => {
    const dir = packCopy((m) => {
      m.id = "Bad Id";
      delete m.label;
      m.defaultSkills = ["missing-skill"];
      m.templateFiles.push({ src: "nope.md", dest: "../outside.md" });
    });
    assert.throws(() => validatePack(dir), (e) => {
      assert.match(e.message, /^Invalid pack:/);
      assert.ok(e.problems.some((p) => p.includes('"id" must be lowercase')));
      assert.ok(e.problems.some((p) => p.includes('"label" is required')));
      assert.ok(e.problems.some((p) => p.includes("default skill missing-skill")));
      assert.ok(e.problems.some((p) => p.includes('needs relative "src" and "dest"')));
      return true;
    });
  });

  it("refuses a missing or broken pack.json and the id of a pack fxmind ships", () => {
    const empty = path.join(tmp, "empty");
    fs.mkdirSync(empty);
    assert.throws(() => validatePack(empty), /pack\.json is missing/);
    const broken = packCopy();
    fs.writeFileSync(path.join(broken, "pack.json"), "{ not json");
    assert.throws(() => validatePack(broken), /not valid JSON/);
    assert.throws(() => validatePack(packCopy((m) => { m.id = "web"; })), /shipped with fxmind/);
  });

  it("refuses any file that is not pack.json or Markdown, naming it", () => {
    const dir = packCopy((m, d) => {
      fs.writeFileSync(path.join(d, "install.sh"), "rm -rf /");
      fs.writeFileSync(path.join(d, "skills", "hello-basics", "helper.js"), "process.exit()");
    });
    assert.throws(() => validatePack(dir), (error) => {
      assert.ok(error.problems.includes("install.sh: not allowed (a pack holds only pack.json and .md or .mdc files)"));
      assert.ok(error.problems.some((p) => p.startsWith("skills/hello-basics/helper.js: not allowed")));
      return true;
    });
  });
});

describe("pack add", () => {
  it("installs a local pack in the packs folder and fxmind lists it", async () => {
    const result = await addPack(EXAMPLE, { packsDir });
    assert.deepEqual(result, { status: "installed", id: "hello", dir: path.join(packsDir, "hello") });
    assert.ok(fs.existsSync(path.join(packsDir, "hello", "skills", "hello-basics", "SKILL.md")));
    assert.ok(packs.listPackIds().includes("hello"));
    assert.equal(packs.getPack("hello").source, "external");
    assert.equal(readSources(packsDir).hello.source, EXAMPLE);
  });

  it("copies nothing when the pack is invalid", async () => {
    const dir = packCopy((m, d) => fs.writeFileSync(path.join(d, "run.py"), "print(1)"));
    await assert.rejects(addPack(dir, { packsDir }), /run\.py: not allowed/);
    assert.equal(fs.existsSync(path.join(packsDir, "hello")), false);
  });

  it("asks before overwriting: no keeps the installed pack, yes replaces it", async () => {
    await addPack(EXAMPLE, { packsDir });
    const skill = path.join(packsDir, "hello", "skills", "hello-basics", "SKILL.md");
    fs.writeFileSync(skill, "installed copy");
    const changed = packCopy((m) => { m.description = "a newer version"; });

    const asked = [];
    const kept = await addPack(changed, { packsDir, confirm: async (id) => { asked.push(id); return false; } });
    assert.equal(kept.status, "kept");
    assert.deepEqual(asked, ["hello"]);
    assert.equal(fs.readFileSync(skill, "utf8"), "installed copy");

    // No one to ask and no --force: nothing changes either.
    assert.equal((await addPack(changed, { packsDir })).status, "kept");

    const replaced = await addPack(changed, { packsDir, confirm: async () => true });
    assert.equal(replaced.status, "installed");
    assert.notEqual(fs.readFileSync(skill, "utf8"), "installed copy");
    assert.equal(packs.getPack("hello").description, "a newer version");
  });

  it("clones a git URL, at a tag and from a folder of the repository", async () => {
    const repo = path.join(tmp, "repo");
    fs.mkdirSync(repo);
    fs.cpSync(EXAMPLE, path.join(repo, "packs", "hello"), { recursive: true });
    fs.writeFileSync(path.join(repo, "README.txt"), "not part of the pack");
    git(repo, "init", "-q");
    git(repo, "add", ".");
    git(repo, "commit", "-q", "-m", "pack");
    git(repo, "tag", "v1.0.0");
    const url = `file://${repo.replace(/\\/g, "/")}`;

    const result = await addPack(url, { packsDir, ref: "v1.0.0", path: "packs/hello" });
    assert.equal(result.status, "installed");
    assert.ok(fs.existsSync(path.join(packsDir, "hello", "pack.json")));
    assert.equal(fs.existsSync(path.join(packsDir, "hello", "README.txt")), false);
    assert.deepEqual(
      { source: readSources(packsDir).hello.source, ref: readSources(packsDir).hello.ref, path: readSources(packsDir).hello.path },
      { source: url, ref: "v1.0.0", path: "packs/hello" },
    );
    // The repository root is not a pack: README.txt is refused.
    await assert.rejects(addPack(url, { packsDir, force: true }), /pack\.json is missing|README\.txt: not allowed/);
    await assert.rejects(addPack(url, { packsDir, path: "../.." }), /--path must stay inside the source/);
  });
});

describe("pack remove", () => {
  it("removes an external pack after a yes and never a shipped one", async () => {
    await addPack(EXAMPLE, { packsDir });
    assert.equal((await removePack("hello", { packsDir, confirm: async () => false })).status, "kept");
    assert.ok(fs.existsSync(path.join(packsDir, "hello")));
    assert.equal((await removePack("hello", { packsDir, confirm: async () => true })).status, "removed");
    assert.equal(fs.existsSync(path.join(packsDir, "hello")), false);
    assert.equal(readSources(packsDir).hello, undefined);
    await assert.rejects(removePack("web", { packsDir, force: true }), /ships with fxmind/);
  });
});
