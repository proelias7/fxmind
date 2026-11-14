/**
 * scripts/lib/panel-orchestration.js
 * 
 * Orchestration configuration management for FXMind.
 * Supports project-level (.fxmind/orchestration.json) and global (panel.json) settings.
 */

const fs = require("fs");
const path = require("path");
const { readPanelConfig, writePanelConfig } = require("./panel-api");

const DEFAULT_ORCHESTRATION = {
  enabled: true,
  mode: "auto", // 'auto' | 'confirm' | 'off'
  strategy: "smart", // 'smart' | 'parallel' | 'sequential'
  maxConcurrent: 3,
  routing: {
    rules: [
      { match: "explore|search|find|read|scout", provider: "opencode", model: null, effort: "low" },
      { match: "review|audit|verify|check", provider: "claude", model: null, effort: "high" },
      { match: "implement|code|refactor|write|fix", provider: "codex", model: null, effort: "medium" },
      { match: "test|unit-test|benchmark", provider: "opencode", model: null, effort: "medium" },
      { match: "query|memory|explain", provider: null, model: null, effort: "low" },
    ],
    defaultProvider: null, // null = use active/default CLI
    defaultModel: null,
    defaultEffort: "medium",
  },
  allowedProviders: null, // null = all available providers
  autoOpenBrowser: true, // open browser on orchestration start
};

function readJsonSafe(filePath, fallback = null) {
  if (!filePath || !fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJsonSafe(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function projectOrchestrationPath(projectRoot) {
  if (!projectRoot) return null;
  return path.join(path.resolve(projectRoot), ".fxmind", "orchestration.json");
}

function readOrchestrationConfig(projectRoot = null) {
  const globalConfig = readPanelConfig();
  const globalOrch = globalConfig.orchestration && typeof globalConfig.orchestration === "object"
    ? globalConfig.orchestration
    : {};

  let projectOrch = {};
  if (projectRoot) {
    const projPath = projectOrchestrationPath(projectRoot);
    if (projPath && fs.existsSync(projPath)) {
      projectOrch = readJsonSafe(projPath, {}) || {};
    }
  }

  // Merge order: DEFAULT -> global panel.json -> project .fxmind/orchestration.json
  const merged = {
    ...DEFAULT_ORCHESTRATION,
    ...globalOrch,
    ...projectOrch,
    routing: {
      ...DEFAULT_ORCHESTRATION.routing,
      ...(globalOrch.routing || {}),
      ...(projectOrch.routing || {}),
      rules: (projectOrch.routing && Array.isArray(projectOrch.routing.rules) && projectOrch.routing.rules.length)
        ? projectOrch.routing.rules
        : (globalOrch.routing && Array.isArray(globalOrch.routing.rules) && globalOrch.routing.rules.length)
          ? globalOrch.routing.rules
          : DEFAULT_ORCHESTRATION.routing.rules,
    },
  };

  return merged;
}

function writeOrchestrationConfig(config = {}, projectRoot = null, scope = "project") {
  if (scope === "global" || !projectRoot) {
    const globalConfig = readPanelConfig();
    globalConfig.orchestration = {
      ...(globalConfig.orchestration || {}),
      ...config,
      updatedAt: new Date().toISOString(),
    };
    writePanelConfig(globalConfig);
    return readOrchestrationConfig(projectRoot);
  }

  const projPath = projectOrchestrationPath(projectRoot);
  if (projPath) {
    const existing = readJsonSafe(projPath, {}) || {};
    const updated = {
      ...existing,
      ...config,
      updatedAt: new Date().toISOString(),
    };
    writeJsonSafe(projPath, updated);
  }

  return readOrchestrationConfig(projectRoot);
}

function getOrchestrationSettings(projectRoot) {
  const config = readOrchestrationConfig(projectRoot);
  const projPath = projectOrchestrationPath(projectRoot);
  const hasProjectConfig = Boolean(projPath && fs.existsSync(projPath));

  return {
    ok: true,
    hasProjectConfig,
    config,
  };
}

function putOrchestrationSettings(projectRoot, body = {}) {
  const scope = body.scope || (projectRoot ? "project" : "global");
  const updated = writeOrchestrationConfig(body.config || body, projectRoot, scope);
  return {
    ok: true,
    scope,
    config: updated,
  };
}

module.exports = {
  DEFAULT_ORCHESTRATION,
  readOrchestrationConfig,
  writeOrchestrationConfig,
  getOrchestrationSettings,
  putOrchestrationSettings,
};
