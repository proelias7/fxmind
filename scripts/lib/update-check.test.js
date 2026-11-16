const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  compareSemver,
  parseSemver,
  isOptOut,
  isLayoutStale,
  buildAgentContext,
  CURRENT_LAYOUT_VERSION,
} = require("./update-check");
const { installHooks, FXMIND_COMMANDS, normalizeHookSpec } = require("../hooks");

const STATE_PATH = path.join(os.homedir(), ".fxmind", "update-check.json");
let stateBackup = null;

function writePacks(projectRoot, extra = {}) {
  const dir = path.join(projectRoot, ".fxmind");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "packs.json"),
    `${JSON.stringify({ version: 1, layoutVersion: 1, ...extra }, null, 2)}\n`,
    "utf8",
  );
}

describe("update-check", () => {
  beforeEach(() => {
    if (fs.existsSync(STATE_PATH)) {
      stateBackup = fs.readFileSync(STATE_PATH, "utf8");
    } else {
      stateBackup = null;
    }
  });

  afterEach(() => {
    if (stateBackup === null) {
      try {
        fs.unlinkSync(STATE_PATH);
      } catch {
        // ignore
      }
    } else {
      fs.writeFileSync(STATE_PATH, stateBackup, "utf8");
    }
  });

  it("compareSemver orders versions", () => {
    assert.equal(compareSemver("1.4.0", "1.3.9"), 1);
    assert.equal(compareSemver("1.4.0", "1.4.0"), 0);
    assert.equal(compareSemver("1.3.0", "1.4.0"), -1);
    assert.deepEqual(parseSemver("2.1.3"), [2, 1, 3]);
  });

  it("detects layout stale from packs.json", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fxupd-"));
    writePacks(dir, { layoutVersion: 1 });
    assert.equal(isLayoutStale(dir), true);
    writePacks(dir, { layoutVersion: CURRENT_LAYOUT_VERSION });
    assert.equal(isLayoutStale(dir), false);
  });

  it("respects opt-out env and packs.json flag", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fxupd-"));
    writePacks(dir);
    const prev = process.env.FXMIND_NO_UPDATE_CHECK;
    process.env.FXMIND_NO_UPDATE_CHECK = "1";
    assert.equal(isOptOut(dir), true);
    delete process.env.FXMIND_NO_UPDATE_CHECK;
    writePacks(dir, { autoUpdateCheck: false });
    assert.equal(isOptOut(dir), true);
    if (prev !== undefined) process.env.FXMIND_NO_UPDATE_CHECK = prev;
  });

  it("buildAgentContext only when shouldNotify", () => {
    const ctx = buildAgentContext({
      shouldNotify: true,
      message: "nova versão 9.0.0 disponível",
      remoteVersion: "9.0.0",
      localVersion: "1.0.0",
    });
    assert.match(ctx, /AskQuestion/);
    assert.equal(buildAgentContext({ shouldNotify: false, message: "x" }), null);
  });
});

describe("hooks sessionStart wiring", () => {
  it("registers sessionStart hooks (update-notifier + graph-freshness)", () => {
    const specs = Array.isArray(FXMIND_COMMANDS.sessionStart)
      ? FXMIND_COMMANDS.sessionStart
      : [FXMIND_COMMANDS.sessionStart];
    const commands = specs.map((s) => normalizeHookSpec(s).command);
    assert.ok(commands.includes("node .cursor/hooks/update-notifier.js"));
    assert.ok(commands.includes("node .cursor/hooks/graph-freshness.js"));
    assert.ok(commands.includes("node .cursor/hooks/memory-first.js sessionStart"));
    const notifier = specs.find((s) => s.command === "node .cursor/hooks/update-notifier.js");
    const freshness = specs.find((s) => s.command === "node .cursor/hooks/graph-freshness.js");
    assert.equal(normalizeHookSpec(notifier).timeout, 8);
    assert.equal(normalizeHookSpec(freshness).timeout, 12);
  });

  it("installHooks removes obsolete FXMIND Stop injection while preserving vendor Stop hooks", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fxhook-legacy-"));
    try {
      writePacks(dir);
      const cursor=path.join(dir,".cursor");
      fs.mkdirSync(cursor,{recursive:true});
      fs.writeFileSync(path.join(cursor,"hooks.json"),JSON.stringify({version:1,hooks:{
        stop:[
          {command:"node .cursor/hooks/learn-prompt.js",timeout:15},
          {command:"node other-vendor-stop.js",timeout:5},
        ],
      }}));
      installHooks(dir,{gitHook:false});
      const config=JSON.parse(fs.readFileSync(path.join(cursor,"hooks.json"),"utf8"));
      assert.equal(config.hooks.stop.length,1);
      assert.equal(config.hooks.stop[0].command,"node other-vendor-stop.js");
      assert.equal(config.hooks.preToolUse.some(e=>String(e.command).includes("gate-guard.js")),true);
    } finally { fs.rmSync(dir,{recursive:true,force:true}); }
  });

  it("installHooks writes sessionStart into hooks.json", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fxhook-"));
    writePacks(dir);
    installHooks(dir, { gitHook: false });
    const hooksJson = JSON.parse(
      fs.readFileSync(path.join(dir, ".cursor", "hooks.json"), "utf8"),
    );
    const entries = hooksJson.hooks.sessionStart || [];
    assert.ok(
      entries.some((e) => e.command.includes(".cursor/hooks/update-notifier.js")),
    );
    assert.ok(
      entries.some((e) => e.command.includes(".cursor/hooks/graph-freshness.js")),
    );
    assert.ok(fs.existsSync(path.join(dir, ".cursor", "hooks", "update-notifier.js")));
    assert.ok(fs.existsSync(path.join(dir, ".cursor", "hooks", "graph-freshness.js")));
    assert.ok(fs.existsSync(path.join(dir, ".cursor", "hooks", "lib", "update-check.js")));
    assert.equal(fs.existsSync(path.join(dir, ".cursor", "hooks", "lib", "stop-followup.js")), false);
    const stop = (hooksJson.hooks.stop || []).find(
      (e) => e.command.includes(".cursor/hooks/learn-prompt.js"),
    );
    assert.equal(stop, undefined);
  });
});
