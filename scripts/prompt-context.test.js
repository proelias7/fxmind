const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const promptContext = require("./prompt-context");
const mcp = require("./mcp-server");

function writeProject(root) {
  const mem = path.join(root, ".fxmind", "memory");
  fs.mkdirSync(mem, { recursive: true });
  fs.writeFileSync(
    path.join(mem, "garage.md"),
    "---\ntopic: garage\nupdated: 2026-09-01\nlang: en-compact\npaths: [resources/garage/client.lua]\ntriggers: [garage, spawn vehicle]\n---\n# garage\nGarage opens NUI; server checks ownership.\n",
    "utf8",
  );
}

describe("prompt-context", () => {
  let root;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "fxprompt-"));
    writeProject(root);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("skips short prompts and other slash commands", () => {
    assert.equal(promptContext.shouldSkipPrompt("oi"), true);
    assert.equal(promptContext.shouldSkipPrompt("/compact agora por favor"), true);
    assert.equal(promptContext.shouldSkipPrompt("/fxmind task garagem nao abre"), false);
    assert.equal(promptContext.shouldSkipPrompt("a garagem nao abre"), false);
  });

  it("finds the project root from a nested directory", () => {
    const nested = path.join(root, "resources", "garage");
    fs.mkdirSync(nested, { recursive: true });
    assert.equal(promptContext.findProjectRoot(nested), root);
  });

  it("hook emits additionalContext for a matching prompt", () => {
    const run = spawnSync(process.execPath, [path.join(__dirname, "install.js"), "context", "--hook"], {
      input: JSON.stringify({ prompt: "a garagem nao abre", cwd: root, hook_event_name: "UserPromptSubmit" }),
      encoding: "utf8",
      env: { ...process.env, FXMIND_NO_UPDATE_CHECK: "1", FXMIND_JEV_ENABLED: "false" },
    });
    assert.equal(run.status, 0, run.stderr);
    const out = JSON.parse(run.stdout);
    assert.equal(out.hookSpecificOutput.hookEventName, "UserPromptSubmit");
    assert.match(out.hookSpecificOutput.additionalContext, /garage/);
    assert.match(out.hookSpecificOutput.additionalContext, /Garage opens NUI/);
  });

  it("hook prints nothing when no memory matches", () => {
    const run = spawnSync(process.execPath, [path.join(__dirname, "install.js"), "context", "--hook"], {
      input: JSON.stringify({ prompt: "explique o que e um monad", cwd: root }),
      encoding: "utf8",
      env: { ...process.env, FXMIND_NO_UPDATE_CHECK: "1", FXMIND_JEV_ENABLED: "false" },
    });
    assert.equal(run.status, 0);
    assert.equal(run.stdout, "");
  });

  it("installs the Claude Code hook once and keeps other settings", () => {
    const settingsPath = path.join(root, ".claude", "settings.json");
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify({ permissions: { allow: ["Bash(ls)"] } }));
    assert.equal(promptContext.installClaudePromptHook(root).changed, true);
    assert.equal(promptContext.installClaudePromptHook(root).changed, false);
    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    assert.deepEqual(settings.permissions, { allow: ["Bash(ls)"] });
    const commands = settings.hooks.UserPromptSubmit.flatMap((g) => g.hooks.map((h) => h.command));
    assert.deepEqual(commands, [promptContext.CLAUDE_HOOK_COMMAND]);
    for (const event of ["PreToolUse", "PostToolUse"]) {
      assert.equal(settings.hooks[event].length, 1, event + " installed once");
      assert.match(settings.hooks[event][0].hooks[0].command, /claude-adapter\.js/);
    }
    assert.equal(settings.hooks.Stop, undefined);
    assert.equal(settings.hooks.PreToolUse[0].matcher, "Edit|Write|MultiEdit|NotebookEdit");
    for (const file of ["claude-adapter.js", "gate-guard.js", "lib/task-sessions.js"]) {
      assert.ok(fs.existsSync(path.join(root, ".claude", "hooks", file)), file);
    }
  });

  it("replaces the legacy bare `fxmind context --hook` and keeps other prompt hooks", () => {
    const settingsPath = path.join(root, ".claude", "settings.json");
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify({ hooks: { UserPromptSubmit: [
      { hooks: [{ type: "command", command: "fxmind context --hook", timeout: 10 }] },
      { hooks: [{ type: "command", command: "node other-vendor-prompt.js", timeout: 5 }] },
    ] } }));
    assert.equal(promptContext.installClaudePromptHook(root).changed, true);
    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    const commands = settings.hooks.UserPromptSubmit.flatMap((g) => g.hooks.map((h) => h.command));
    assert.deepEqual(commands, ["node other-vendor-prompt.js", promptContext.CLAUDE_HOOK_COMMAND]);
    assert.equal(promptContext.installClaudePromptHook(root).changed, false);
  });

  it("the installed prompt hook works with no `fxmind` on PATH", () => {
    promptContext.installClaudePromptHook(root);
    const adapter = path.join(root, ".claude", "hooks", "claude-adapter.js");
    const run = spawnSync(process.execPath, [adapter, "prompt"], {
      cwd: root,
      input: JSON.stringify({ prompt: "a garagem nao abre", cwd: root, hook_event_name: "UserPromptSubmit" }),
      encoding: "utf8",
      env: {
        ...process.env, CLAUDE_PROJECT_DIR: root, PATH: path.dirname(process.execPath), Path: undefined,
        FXMIND_CLI: path.join(__dirname, "install.js"), FXMIND_BIN: "",
        FXMIND_NO_UPDATE_CHECK: "1", FXMIND_JEV_ENABLED: "false",
      },
    });
    assert.equal(run.status, 0, run.stderr);
    const out = JSON.parse(run.stdout);
    assert.equal(out.hookSpecificOutput.hookEventName, "UserPromptSubmit");
    assert.match(out.hookSpecificOutput.additionalContext, /Garage opens NUI/);
  });

  it("locates a global fxmind CLI in the Windows npm folder without PATH", () => {
    const { locateCli } = require("./lib/fxmind-cli");
    const appData = fs.mkdtempSync(path.join(os.tmpdir(), "fxappdata-"));
    const cli = path.join(appData, "npm", "node_modules", "fxmind", "scripts", "install.js");
    fs.mkdirSync(path.dirname(cli), { recursive: true });
    fs.writeFileSync(cli, "");
    try {
      const env = { APPDATA: appData, PATH: "", HOME: appData };
      assert.equal(locateCli(env, path.join(appData, "nowhere", "node.exe"), "win32"), cli);
      assert.equal(locateCli({ PATH: "", HOME: appData }, path.join(appData, "nowhere", "node"), "linux"), null);
    } finally {
      fs.rmSync(appData, { recursive: true, force: true });
    }
  });

  it("installer removes legacy FXMIND Stop while preserving another provider", () => {
    const settingsPath = path.join(root, ".claude", "settings.json");
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify({ hooks: {
      Stop: [{ hooks: [
        { type: "command", command: 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/claude-adapter.js" stop', timeout: 15 },
        { type: "command", command: "node other-vendor-stop.js", timeout: 15 },
      ] }],
    } }));
    assert.equal(promptContext.installClaudePromptHook(root).changed, true);
    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    assert.deepEqual(settings.hooks.Stop[0].hooks.map(x=>x.command), ["node other-vendor-stop.js"]);
    assert.equal(promptContext.installClaudePromptHook(root).changed, false);
  });

  it("claude adapter blocks code edits until Gates A and B, then stays silent", () => {
    fs.mkdirSync(path.join(root, ".fxmind", "memory"), { recursive: true });
    fs.writeFileSync(path.join(root, ".fxmind", "packs.json"), '{"packs":[]}');
    promptContext.installClaudePromptHook(root);
    const adapter = path.join(root, ".claude", "hooks", "claude-adapter.js");
    const run = (event, payload) => spawnSync(process.execPath, [adapter, event], {
      cwd: root, input: JSON.stringify(payload), encoding: "utf8",
      env: { ...process.env, CLAUDE_PROJECT_DIR: root, FXMIND_GATE_WARN: "", FXMIND_AUTO_TASK: "" },
    });
    const edit = { tool_name: "Edit", tool_input: { file_path: path.join(root, "src", "a.js") }, session_id: "s1" };
    const denied = JSON.parse(run("pre", edit).stdout);
    assert.equal(denied.hookSpecificOutput.permissionDecision, "deny");
    assert.match(denied.hookSpecificOutput.permissionDecisionReason, /Gate|fxmind_start_task/);
    const memoryEdit = { tool_name: "Write", tool_input: { file_path: path.join(root, ".fxmind", "memory", "x.md") } };
    assert.equal(run("pre", memoryEdit).stdout, "", "non-code paths are left to Claude's own rules");
    assert.equal(run("stop", { stop_hook_active: true }).stdout, "");
  });

  it("translates Cursor hook answers to Claude's protocol", () => {
    const { translate } = require("../templates/hooks/claude-adapter");
    assert.equal(translate("pre", { permission: "allow" }), null);
    assert.equal(translate("post", {}), null);
    assert.deepEqual(translate("post", { additional_context: "drift" }),
      { hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: "drift" } });
    assert.equal(translate("stop", { followup_message: "old mandatory review" }), null);
    assert.equal(translate("stop", { followup_message: "old mandatory review" }, { stop_hook_active: true }), null);
  });
});

describe("mcp tool groups", () => {
  let root;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "fxmcp-"));
    fs.mkdirSync(path.join(root, ".fxmind"), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  const names = (list) => list.map((tool) => tool.name);

  it("hides FiveM tools without the fivem pack and DB tools without a connection", () => {
    fs.writeFileSync(path.join(root, ".fxmind", "packs.json"), JSON.stringify({ packs: [] }));
    const listed = names(mcp.listTools(root, {}));
    assert.ok(listed.includes("fxmind_query"));
    assert.ok(listed.includes("fxmind_db_status"));
    assert.ok(listed.includes("fxmind_panel_wait"));
    assert.ok(!listed.some((n) => n.startsWith("fxmind_fivem_")));
    assert.ok(!listed.includes("fxmind_db_query"));
  });

  it("keeps FiveM tools when the pack is installed or the manifest is missing", () => {
    assert.ok(names(mcp.listTools(root, {})).includes("fxmind_fivem_status"));
    fs.writeFileSync(path.join(root, ".fxmind", "packs.json"), JSON.stringify({ packs: [{ id: "fivem" }] }));
    assert.ok(names(mcp.listTools(root, {})).includes("fxmind_fivem_status"));
  });

  it("FXMIND_MCP_TOOLS overrides detection", () => {
    assert.equal(mcp.listTools(root, { FXMIND_MCP_TOOLS: "all" }, "win32").length, mcp.TOOL_DEFS.length);
    // Off Windows "all" still leaves out the desktop tools, which cannot run there.
    assert.equal(mcp.listTools(root, { FXMIND_MCP_TOOLS: "all" }, "linux").length, mcp.TOOL_DEFS.length - 16);
    const core = names(mcp.listTools(root, { FXMIND_MCP_TOOLS: "core" }));
    assert.ok(!core.includes("fxmind_panel_wait"));
    assert.ok(core.includes("fxmind_record_gate"));
    assert.ok(core.includes("fxmind_independent_review"));
  });

  it("formats query results as Markdown and other results as compact JSON", () => {
    const text = mcp.formatToolResult("fxmind_gate_status", { ok: true, a: 1 });
    assert.equal(text, '{"ok":true,"a":1}');
    const query = mcp.formatToolResult("fxmind_query", {
      ok: true,
      memories: [{ slug: "x", topic: "x", path: ".fxmind/memory/x.md", content: "Body", tokens: 1 }],
      tokensUsed: 1,
      budget: 10,
    });
    assert.match(query, /## x — \.fxmind\/memory\/x\.md\nBody/);
  });
});

describe("prompt hook budget and topic retrieval", () => {
  it("falls back to the local context when the network part runs past its budget", async () => {
    const slow = () => new Promise((resolve) => setTimeout(() => resolve("jev context"), 2000));
    const t0 = Date.now();
    const out = await promptContext.contextWithin(50, slow, () => "local context");
    assert.equal(out, "local context");
    assert.ok(Date.now() - t0 < 1000, "does not wait for the slow network part");
    assert.equal(await promptContext.contextWithin(500, async () => "jev context", () => "local"), "jev context");
    assert.equal(await promptContext.contextWithin(500, async () => { throw new Error("down"); }, () => "local"), "local");
  });

  it("a question naming a topic memory loads that memory, not code of other resources that mention it", () => {
    const tools = require("./fxmind-tools");
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "fxnamed-"));
    try {
      const write = (rel, text) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); };
      write(".fxmind/packs.json", '{"packs":[]}');
      // Block-list frontmatter, as real memories are often written.
      write(".fxmind/memory/pelucia.md", "---\ntopic: pelucia\nresources: [pelucia]\npaths:\n  - resources/pelucia/fxmanifest.lua\ntriggers:\n  - pelucia\n  - colecoes\n---\n# pelucia\n\nFiles:\n- manifest: `resources/pelucia/fxmanifest.lua`\n\nRecipe:\n1. Colecoes, pets, trocas e puffs de pelucias.\n");
      write("resources/pelucia/fxmanifest.lua", "fx_version 'cerulean'\n");
      // Other resources whose code mentions the word.
      write("resources/boxes/shared/config.lua", "local function loadPeluciaCatalog()\n  return LoadResourceFile('pelucia', 'config/catalog.lua')\nend\n");
      write("resources/jogos/bridge.lua", "function Bridge.PeluciaAtiva()\n  return GetResourceState('pelucia') == 'started'\nend\n");
      // The code index reads tracked files: without git the bug did not show.
      require("child_process").execFileSync("git", ["init", "-q"], { cwd: root });
      require("child_process").execFileSync("git", ["add", "-A"], { cwd: root });
      tools.buildGraph(root, { updateHtml: false });
      const result = tools.queryGraph(root, "o que e a resource pelucia", { budget: 1200 });
      assert.equal(result.ok, true);
      assert.equal(result.memories[0].slug, "pelucia", JSON.stringify(result.memories.map((m) => m.slug || m.id)));
      assert.deepEqual(tools.listMemories(root)[0].paths, ["resources/pelucia/fxmanifest.lua"]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("injected blocks around the typed words", () => {
  it("retrieval and the kind guess read only what was typed, not Claude in Chrome's instructions", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "fxtyped-"));
    try {
      writeProject(root);
      const browser = "<browser_instruction># Claude in Chrome browser automation\n" +
        "If a tool call failed with an error, the page is broken or not working, fix the selector and debug it.\n".repeat(20) +
        "</browser_instruction>";
      const typed = "o que faz a garagem?";
      const plain = promptContext.buildPromptContext(root, typed);
      const wrapped = promptContext.buildPromptContext(root, `${browser}\n\n${typed}`);
      assert.equal(wrapped, plain, "the browser block changes nothing");
      assert.doesNotMatch(wrapped, /Task kind: fix/);
      assert.match(wrapped, /Garage opens NUI/);
      // Only the browser block: nothing typed, nothing preloaded.
      assert.equal(promptContext.buildPromptContext(root, browser), "");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
