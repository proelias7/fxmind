"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");
const { CONFIG_FILE, promptJevSetup, saveJevSetup } = require("./jev-setup");
const { jevConfig, jevStatus } = require("./lib/jev");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fxmind-jev-setup-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, file: path.join(root, "jev.env") };
}

test("declining optional Jev setup never requests or writes a key", async (t) => {
  const { file } = fixture(t);
  const setup = await promptJevSetup({ optional: true, file, prompts: {
    confirm: async () => false, password: async () => { throw Error("must not prompt"); },
  } });
  assert.equal(setup, null);
  assert.equal(fs.existsSync(file), false);
});

test("hidden prompt validates the key and cancellation leaves config untouched", async (t) => {
  const { file } = fixture(t);
  let prompt;
  const setup = await promptJevSetup({ file, prompts: { password: async (options) => { prompt = options; return "fixture-key-only"; } } });
  assert.equal(prompt.mask, "*");
  assert.notEqual(prompt.validate(""), true);
  assert.notEqual(prompt.validate("key\nINJECT=true"), true);
  assert.equal(prompt.validate("fixture-key-only"), true);
  assert.deepEqual(saveJevSetup(setup, file), { enabled: true, configured: true });
  const previous = fs.readFileSync(file, "utf8");
  const cancel = Object.assign(new Error("cancelled"), { name: "ExitPromptError" });
  await assert.rejects(promptJevSetup({ file, prompts: { confirm: async () => false, password: async () => { throw cancel; } } }), /cancelled/);
  assert.equal(fs.readFileSync(file, "utf8"), previous);
  assert.match(fs.readFileSync(path.join(path.dirname(file), ".gitignore"), "utf8"), /^\/jev\.env$/m);
});

test("retains an existing key and settings without showing the key again", async (t) => {
  const { file } = fixture(t);
  fs.writeFileSync(file, 'FXMIND_JEV_API_KEY="fixture-key-only"\nFXMIND_JEV_TIMEOUT_MS=800\n');
  const setup = await promptJevSetup({ file, prompts: {
    confirm: async () => true, password: async () => { throw Error("must not prompt"); },
  } });
  saveJevSetup(setup, file);
  assert.equal(require("dotenv").parse(fs.readFileSync(file)).FXMIND_JEV_TIMEOUT_MS, "800");
});

test("user-level config is read by the runtime with project and process overrides", (t) => {
  const { root, file } = fixture(t);
  saveJevSetup({ apiKey: "fixture-key-only" }, file);
  const read = fs.readFileSync;
  t.mock.method(fs, "readFileSync", (name, ...args) => read(name === CONFIG_FILE ? file : name, ...args));
  assert.equal(jevConfig({}, root).apiKey, "fixture-key-only");
  assert.equal(jevStatus({}, root).active, true);
  assert.doesNotMatch(JSON.stringify(jevStatus({}, root)), /fixture-key-only/);
  fs.writeFileSync(path.join(root, ".env"), "FXMIND_JEV_ENABLED=false\n");
  assert.equal(jevStatus({}, root).active, false);
  assert.equal(jevStatus({ FXMIND_JEV_ENABLED: "true" }, root).active, true);
  assert.equal(jevConfig({ TYPESAFE_API_KEY: "env-key" }, root).apiKey, "env-key");
  fs.writeFileSync(path.join(root, ".env"), "TYPESAFE_API_KEY=project-key\n");
  assert.equal(jevConfig({}, root).apiKey, "project-key");
});

test("refuses to write credentials to a file already tracked by git", (t) => {
  const { root, file } = fixture(t);
  fs.writeFileSync(file, "FXMIND_JEV_ENABLED=false\n");
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["add", "jev.env"], { cwd: root });
  assert.throws(() => saveJevSetup({ apiKey: "fixture-key-only" }, file), /Não foi possível salvar/);
  assert.equal(fs.readFileSync(file, "utf8"), "FXMIND_JEV_ENABLED=false\n");
});

test("init and Jev CLI require a real interactive terminal and do not echo argument values", (t) => {
  const { root } = fixture(t);
  const cli = path.resolve(__dirname, "install.js");
  for (const args of [["init", "-y"], ["jev", "--key", "fixture-secret-only"]]) {
    const result = spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /terminal interativo/);
    assert.doesNotMatch(result.stderr + result.stdout, /fixture-secret-only/);
    assert.equal(fs.existsSync(path.join(root, ".fxmind")), false);
  }
  assert.match(execFileSync(process.execPath, [cli, "jev", "--help"], { cwd: root, encoding: "utf8" }), /entrada oculta/);
});
