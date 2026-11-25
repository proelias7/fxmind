/**
 * fxmind health — deterministic check (and safe repair) of a project's fxmind
 * setup, memories, playbooks and graph. No LLM.
 *
 *   fxmind health          report
 *   fxmind health --fix    apply the safe repairs, report what is left
 *
 * Safe repairs: the Claude prompt hook (legacy command / missing hook files),
 * paths of moved files in memories and playbooks when the new location is
 * unique (same resource folder + file name), and a stale knowledge graph.
 * What needs judgment (an anchor whose text changed, a file that no longer
 * exists anywhere, empty paths[]) is reported with the agent command to run.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const SKIP_DIRS = new Set([".git", "node_modules", ".fxmind", ".cursor", ".claude", "cache", "dist"]);
const WALK_LIMIT = 300_000;

// ── Repository file index ───────────────────────────────────────────────────

/** Every file (and its parent folders) of the project, as POSIX relative paths. */
function fileIndex(root) {
  let files = null;
  const git = spawnSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
    cwd: root, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, windowsHide: true,
  });
  if (git.status === 0 && git.stdout) files = git.stdout.split("\0").filter(Boolean);
  // Nested repositories (e.g. resources/[weapons] cloned inside the project)
  // are invisible to the parent's ls-files: walk them as well.
  const extra = [];
  const walk = (dir, rel, depth) => {
    if (extra.length > WALK_LIMIT || depth > 12) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path.join(dir, entry.name), childRel, depth + 1);
      else if (entry.isFile()) extra.push(childRel);
    }
  };
  if (!files) walk(root, "", 0);
  else {
    for (const nested of nestedRepos(root, files)) walk(path.join(root, nested), nested, 0);
  }
  const all = [...new Set([...(files || []), ...extra])];
  const dirs = new Set();
  for (const file of all) {
    let i = file.lastIndexOf("/");
    while (i > 0) {
      const dir = file.slice(0, i);
      if (dirs.has(dir)) break;
      dirs.add(dir);
      i = dir.lastIndexOf("/");
    }
  }
  return { files: all, dirs: [...dirs] };
}

/** Folders with their own .git that the parent repository does not track. */
function nestedRepos(root, tracked) {
  const out = [];
  const trackedDirs = new Set(tracked.map((f) => f.split("/").slice(0, -1).join("/")));
  const scan = (dir, rel, depth) => {
    if (depth > 4) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (!entry.isDirectory() || SKIP_DIRS.has(entry.name)) continue;
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      const abs = path.join(dir, entry.name);
      if (fs.existsSync(path.join(abs, ".git")) && !trackedDirs.has(childRel)) out.push(childRel);
      else scan(abs, childRel, depth + 1);
    }
  };
  scan(root, "", 0);
  return out;
}

function exists(root, rel) {
  try {
    fs.statSync(path.resolve(root, rel));
    return true;
  } catch {
    return false;
  }
}

/**
 * New location of a moved path: the longest suffix (at least folder + name)
 * that exists exactly once. { to } when unique, { candidates } when ambiguous.
 */
function relocate(rel, index) {
  const isDir = /[\\/]$/.test(rel);
  const parts = rel.replace(/\\/g, "/").replace(/\/+$/, "").split("/").filter(Boolean);
  const pool = isDir ? index.dirs : index.files;
  for (let start = 1; parts.length - start >= 2; start++) {
    const suffix = `/${parts.slice(start).join("/")}`;
    const hits = pool.filter((p) => `/${p}`.endsWith(suffix));
    if (hits.length === 1) return { to: hits[0] + (isDir ? "/" : "") };
    if (hits.length > 1) return { candidates: hits.slice(0, 5).map((h) => h + (isDir ? "/" : "")) };
  }
  return {};
}

function replaceAll(text, from, to) {
  return text.split(from).join(to);
}

// ── Checks ──────────────────────────────────────────────────────────────────

function checkSetup(root, report, options) {
  const settingsPath = path.join(root, ".claude", "settings.json");
  if (fs.existsSync(settingsPath)) {
    let settings = null;
    try { settings = JSON.parse(fs.readFileSync(settingsPath, "utf8")); } catch { /* reported below */ }
    if (!settings) {
      report("setup", "warn", ".claude/settings.json is not valid JSON", { hint: "fix the JSON, then fxmind --update -y" });
    } else {
      const promptHooks = (settings.hooks?.UserPromptSubmit || []).flatMap((g) => g?.hooks || []).map((h) => h?.command);
      const fxmindManaged = promptHooks.includes("fxmind context --hook") ||
        (settings.hooks?.PreToolUse || []).some((g) => (g?.hooks || []).some((h) => /claude-adapter\.js/.test(h?.command || "")));
      if (fxmindManaged) {
        const promptContext = require("../prompt-context");
        const legacy = promptHooks.includes("fxmind context --hook");
        const missingHook = !promptHooks.includes(promptContext.CLAUDE_HOOK_COMMAND);
        const missingFiles = !fs.existsSync(path.join(root, ".claude", "hooks", "lib", "fxmind-cli.js"));
        if (legacy || missingHook || missingFiles) {
          const what = legacy
            ? "Claude prompt hook uses `fxmind context --hook`, which fails when npm's global bin is not on PATH"
            : "Claude prompt hook or its files are missing";
          if (options.fix) {
            promptContext.installClaudePromptHook(root);
            report("setup", "fixed", `${what}: reinstalled`);
          } else {
            report("setup", "fixable", what);
          }
        } else {
          report("setup", "ok", "Claude prompt hook");
        }
      }
    }
  }

  const mcpPath = path.join(root, ".mcp.json");
  if (fs.existsSync(mcpPath)) {
    try {
      const entry = JSON.parse(fs.readFileSync(mcpPath, "utf8"))?.mcpServers?.fxmind;
      if (entry) {
        const warnings = require("../mcp-install").mcpLaunchWarnings(entry);
        if (warnings.length) report("setup", "warn", warnings[0], { hint: "npm install -g github:proelias7/fxmind" });
        else report("setup", "ok", "MCP server command");
      }
    } catch {
      report("setup", "warn", ".mcp.json is not valid JSON", { hint: "fix the JSON, then fxmind --update -y" });
    }
  }

  if (!options.skipVersion) {
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(root, ".fxmind", "packs.json"), "utf8"));
      const cli = require("../../package.json").version;
      if (manifest.cliVersion && manifest.cliVersion !== cli) {
        report("setup", "warn", `project installed with fxmind ${manifest.cliVersion}, CLI is ${cli}`, { hint: "fxmind --update -y" });
      }
    } catch {
      // no manifest: nothing to compare
    }
  }
}

function checkMemories(root, report, options, getIndex) {
  const tools = require("../fxmind-tools");
  const { resolveMemoryDir } = require("../global-store");
  const memoryDir = resolveMemoryDir(root);
  const memories = tools.listMemories(root);
  if (!memories.length) return { changed: false };
  let changed = false;
  let emptyPaths = 0;
  for (const memory of memories) {
    if (!memory.paths.length) {
      emptyPaths += 1;
      continue;
    }
    const missing = memory.paths.filter((p) => !exists(root, p));
    if (!missing.length) continue;
    const file = path.join(memoryDir, `${memory.slug}.md`);
    let text = null;
    for (const from of missing) {
      const found = relocate(from, getIndex());
      if (found.to) {
        if (options.fix) {
          text = text ?? fs.readFileSync(file, "utf8");
          text = replaceAll(text, from, found.to);
          report("memories", "fixed", `${memory.slug}: ${from} → ${found.to}`);
        } else {
          report("memories", "fixable", `${memory.slug}: ${from} moved to ${found.to}`);
        }
      } else if (found.candidates) {
        report("memories", "warn", `${memory.slug}: ${from} not found; several candidates (${found.candidates.join(", ")})`,
          { hint: `/fxmind memory health ${memory.slug} fix` });
      } else {
        report("memories", "warn", `${memory.slug}: ${from} no longer exists`, { hint: `/fxmind memory health ${memory.slug} fix` });
      }
    }
    if (text !== null) {
      fs.writeFileSync(file, text, "utf8");
      changed = true;
    }
  }
  if (emptyPaths) {
    report("memories", "warn", `${emptyPaths} memor${emptyPaths === 1 ? "y has" : "ies have"} empty paths[] (drift cannot be detected)`,
      { hint: "/fxmind memory health fix" });
  }
  if (!report.has("memories")) report("memories", "ok", `${memories.length} memories, every path exists`);
  return { changed };
}

function checkPlaybooks(root, report, options, getIndex) {
  const playbooks = require("./playbooks");
  const all = playbooks.loadPlaybooks(root);
  for (const pb of all) {
    const missing = [];
    for (const step of playbooks.resolveSteps(root, pb).steps) {
      if (!step.resolved.ok && /^file not found: /.test(step.resolved.reason)) missing.push(step.file);
    }
    const file = path.join(root, pb.file);
    let text = null;
    for (const from of [...new Set(missing)]) {
      const found = relocate(from, getIndex());
      if (found.to && options.fix) {
        text = text ?? fs.readFileSync(file, "utf8");
        text = replaceAll(text, from, found.to);
        report("playbooks", "fixed", `${pb.id}: ${from} → ${found.to}`);
      } else if (found.to) {
        report("playbooks", "fixable", `${pb.id}: ${from} moved to ${found.to}`);
      }
    }
    if (text !== null) fs.writeFileSync(file, text, "utf8");
    // What is left after relocation needs a human/agent decision.
    const current = text !== null ? playbooks.getPlaybook(root, pb.id) : pb;
    for (const problem of playbooks.checkPlaybook(root, current).errors) {
      const relocatable = !options.fix && /^file not found: /.test(problem) &&
        relocate(problem.replace(/^file not found: /, ""), getIndex()).to;
      if (!relocatable) report("playbooks", "warn", `${pb.id}: ${problem}`, { hint: `/fxmind teach ${pb.id}` });
    }
  }
  if (all.length && !report.has("playbooks")) report("playbooks", "ok", `${all.length} playbook${all.length === 1 ? "" : "s"}, every file and anchor resolves`);
}

function checkGraph(root, report, options, memoriesChanged) {
  const { isGraphStale } = require("./graph-freshness");
  if (!fs.existsSync(path.join(root, ".fxmind"))) return;
  if (!memoriesChanged && !isGraphStale(root)) {
    report("graph", "ok", "knowledge graph is current");
    return;
  }
  if (options.fix) {
    require("../fxmind-tools").buildGraph(root, { updateHtml: false });
    report("graph", "fixed", "knowledge graph rebuilt");
  } else {
    report("graph", "fixable", "knowledge graph is older than the memories");
  }
}

/**
 * → { ok, root, fixed, fixable, warnings, items: [{ area, status, message, hint }] }
 * status: ok | fixed | fixable | warn. ok=true when nothing is left to do.
 */
function runHealth(root, options = {}) {
  const target = path.resolve(root);
  if (!fs.existsSync(path.join(target, ".fxmind"))) {
    return { ok: false, root: target, error: "Project not initialized: missing .fxmind/", items: [], fixed: 0, fixable: 0, warnings: 0 };
  }
  const items = [];
  const report = (area, status, message, extra = {}) => items.push({ area, status, message, ...(extra.hint ? { hint: extra.hint } : {}) });
  report.has = (area) => items.some((item) => item.area === area);
  let index = null;
  const getIndex = () => (index = index || fileIndex(target));

  checkSetup(target, report, options);
  const { changed } = checkMemories(target, report, options, getIndex);
  checkPlaybooks(target, report, options, getIndex);
  checkGraph(target, report, options, changed);

  const count = (status) => items.filter((item) => item.status === status).length;
  return {
    ok: count("fixable") === 0 && count("warn") === 0,
    root: target,
    fixed: count("fixed"),
    fixable: count("fixable"),
    warnings: count("warn"),
    items,
  };
}

const ICON = { ok: "✓", fixed: "✓ fixed", fixable: "↻ fixable", warn: "⚠" };
const TITLE = { setup: "Setup", memories: "Memories", playbooks: "Playbooks", graph: "Graph" };

function formatHealth(result) {
  if (result.error) return result.error;
  const lines = [`fxmind health — ${result.root}`];
  for (const area of Object.keys(TITLE)) {
    const items = result.items.filter((item) => item.area === area);
    if (!items.length) continue;
    lines.push("", TITLE[area]);
    for (const item of items) lines.push(`  ${ICON[item.status]} ${item.message}${item.hint ? `  → ${item.hint}` : ""}`);
  }
  lines.push("");
  if (result.ok) lines.push(result.fixed ? `Healthy after ${result.fixed} fix(es).` : "Healthy.");
  else {
    const parts = [];
    if (result.fixed) parts.push(`${result.fixed} fixed`);
    if (result.fixable) parts.push(`${result.fixable} fixable with \`fxmind health --fix\``);
    if (result.warnings) parts.push(`${result.warnings} need the agent (commands above)`);
    lines.push(parts.join(" · "));
  }
  return lines.join("\n");
}

function runHealthCli(argv = []) {
  const targetArg = argv.indexOf("--target");
  const root = targetArg >= 0 && argv[targetArg + 1] ? argv[targetArg + 1] : process.cwd();
  const result = runHealth(root, { fix: argv.includes("--fix") });
  console.log(argv.includes("--json") ? JSON.stringify(result, null, 2) : formatHealth(result));
  return result.ok ? 0 : 1;
}

module.exports = { runHealth, formatHealth, runHealthCli, relocate, fileIndex };
