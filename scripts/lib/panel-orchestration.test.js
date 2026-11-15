const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const panel = require("./panel-api");
const panelOrch = require("./panel-orchestration");

describe("panel-orchestration", () => {
  let tmpHome;
  let projectRoot;
  let prevHome;
  let prevUserProfile;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "fxorch-home-"));
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fxorch-proj-"));
    prevHome = process.env.HOME;
    prevUserProfile = process.env.USERPROFILE;
    if (process.platform === "win32") {
      process.env.USERPROFILE = tmpHome;
    } else {
      process.env.HOME = tmpHome;
    }
  });

  afterEach(() => {
    if (prevUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = prevUserProfile;
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    fs.rmSync(tmpHome, { recursive: true, force: true });
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it("returns DEFAULT_ORCHESTRATION when neither global nor project config exists", () => {
    const settings = panelOrch.getOrchestrationSettings(projectRoot);
    assert.equal(settings.ok, true);
    assert.equal(settings.hasProjectConfig, false);
    assert.equal(settings.config.enabled, true);
    assert.equal(settings.config.mode, "auto");
    assert.equal(settings.config.strategy, "smart");
    assert.equal(settings.config.maxConcurrent, 3);
    assert.ok(Array.isArray(settings.config.routing.rules));
    assert.equal(settings.config.routing.rules.length, panelOrch.DEFAULT_ORCHESTRATION.routing.rules.length);
  });

  it("merges DEFAULT -> global panel.json -> project .fxmind/orchestration.json hierarchically", () => {
    // 1. Save global settings
    const globalRes = panelOrch.putOrchestrationSettings(projectRoot, {
      scope: "global",
      config: {
        mode: "confirm",
        maxConcurrent: 5,
        routing: {
          defaultProvider: "claude",
          defaultEffort: "high",
        },
      },
    });
    assert.equal(globalRes.ok, true);
    assert.equal(globalRes.scope, "global");

    const afterGlobal = panelOrch.getOrchestrationSettings(projectRoot);
    assert.equal(afterGlobal.hasProjectConfig, false);
    assert.equal(afterGlobal.config.mode, "confirm");
    assert.equal(afterGlobal.config.maxConcurrent, 5);
    assert.equal(afterGlobal.config.routing.defaultProvider, "claude");
    assert.equal(afterGlobal.config.routing.defaultEffort, "high");
    // Inherited default rules
    assert.equal(afterGlobal.config.routing.rules.length, panelOrch.DEFAULT_ORCHESTRATION.routing.rules.length);

    // 2. Override only strategy & maxConcurrent at project scope
    const projRes = panelOrch.putOrchestrationSettings(projectRoot, {
      scope: "project",
      config: {
        strategy: "sequential",
        maxConcurrent: 2,
      },
    });
    assert.equal(projRes.ok, true);
    assert.equal(projRes.scope, "project");

    const afterProject = panelOrch.getOrchestrationSettings(projectRoot);
    assert.equal(afterProject.hasProjectConfig, true);
    // Project overrides take precedence
    assert.equal(afterProject.config.strategy, "sequential");
    assert.equal(afterProject.config.maxConcurrent, 2);
    // Global settings not overridden by project remain active
    assert.equal(afterProject.config.mode, "confirm");
    assert.equal(afterProject.config.routing.defaultProvider, "claude");
    assert.equal(afterProject.config.routing.defaultEffort, "high");
  });

  it("persists project and global configs in isolated files without cross-polluting", () => {
    panelOrch.putOrchestrationSettings(projectRoot, {
      scope: "project",
      config: {
        mode: "confirm",
        allowedProviders: ["opencode", "claude"],
      },
    });

    const projFile = path.join(projectRoot, ".fxmind", "orchestration.json");
    assert.equal(fs.existsSync(projFile), true);
    const projDisk = JSON.parse(fs.readFileSync(projFile, "utf8"));
    assert.equal(projDisk.mode, "confirm");
    assert.deepEqual(projDisk.allowedProviders, ["opencode", "claude"]);

    // Global panel.json should not have been created by a project-scoped write
    assert.equal(fs.existsSync(panel.panelConfigPath()), false);
  });
});


it("persists a custom model per orchestration role without affecting other roles", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fxorch-model-persist-"));
  try {
    const rules = [
      { match: "explore|read", provider: "opencode", model: "cloudflare-ai-gateway/anthropic/claude-fable-5.2", effort: "low" },
      { match: "review|audit", provider: "claude", model: "opus", effort: "high" },
      { match: "implement|code", provider: "codex", model: "gpt-5.4-codex", effort: "medium" },
    ];
    panelOrch.putOrchestrationSettings(root, {
      scope: "project",
      config: { routing: { rules, defaultProvider: null, defaultModel: null, defaultEffort: "medium" } },
    });
    const loaded = panelOrch.getOrchestrationSettings(root).config;
    assert.deepEqual(loaded.routing.rules, rules);
    const savedPath = path.join(root, ".fxmind", "orchestration.json");
    assert.deepEqual(JSON.parse(fs.readFileSync(savedPath, "utf8")).routing.rules, rules);
    const edited = rules.map((rule, idx) => idx === 1 ? { ...rule, model: "sonnet" } : rule);
    panelOrch.putOrchestrationSettings(root, {
      scope: "project",
      config: { routing: { rules: edited, defaultProvider: null, defaultModel: null, defaultEffort: "medium" } },
    });
    const reread = panelOrch.getOrchestrationSettings(root).config.routing.rules;
    assert.equal(reread[0].model, rules[0].model);
    assert.equal(reread[1].model, "sonnet");
    assert.equal(reread[2].model, rules[2].model);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
