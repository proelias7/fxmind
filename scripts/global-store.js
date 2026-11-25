const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");

const { migrateLayoutInDir } = require("./lib/layout");

const SHARED_DIR = ".fxmind";
const GLOBAL_ROOT = path.join(os.homedir(), ".fxmind");
const GLOBAL_PROJECTS_DIR = path.join(GLOBAL_ROOT, "projects");
const GLOBAL_SHARED_DIR = path.join(GLOBAL_ROOT, "shared");
const GLOBAL_SHARED_SKILLS = path.join(GLOBAL_SHARED_DIR, "skills");
const REGISTRY_PATH = path.join(GLOBAL_ROOT, "registry.json");
const STORE_FILE = "store.json";

const PROJECT_DATA_LINKS = [
  "memory",
  "audits",
  "corrections",
  "graph",
  "reports",
];

function normalizeProjectRoot(projectRoot) {
  return path.resolve(projectRoot).replace(/\\/g, "/").toLowerCase();
}

function projectIdForRoot(projectRoot) {
  const normalized = normalizeProjectRoot(projectRoot);
  return crypto.createHash("sha256").update(normalized).digest("hex").slice(0, 16);
}

function projectNameFromRoot(projectRoot) {
  return path.basename(path.resolve(projectRoot)) || "project";
}

function readJson(filePath, fallback = null) {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function readStore(projectRoot) {
  const storePath = path.join(path.resolve(projectRoot), SHARED_DIR, STORE_FILE);
  return readJson(storePath);
}

function isGlobalStore(projectRoot) {
  const store = readStore(projectRoot);
  return store?.mode === "global" && Boolean(store.globalRoot);
}

function getGlobalProjectDir(projectId) {
  return path.join(GLOBAL_PROJECTS_DIR, projectId);
}

function ensureGlobalDirs() {
  fs.mkdirSync(GLOBAL_PROJECTS_DIR, { recursive: true });
  fs.mkdirSync(GLOBAL_SHARED_SKILLS, { recursive: true });
}

function readRegistry() {
  return readJson(REGISTRY_PATH, { version: 1, projects: {} });
}

function writeRegistry(registry) {
  writeJson(REGISTRY_PATH, registry);
}

function registerProject(projectRoot, meta = {}) {
  ensureGlobalDirs();
  const resolvedRoot = path.resolve(projectRoot);
  const projectId = projectIdForRoot(resolvedRoot);
  const registry = readRegistry();

  registry.projects[projectId] = {
    id: projectId,
    name: meta.name || projectNameFromRoot(resolvedRoot),
    root: resolvedRoot.replace(/\\/g, "/"),
    registeredAt: registry.projects[projectId]?.registeredAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    packs: meta.packs || registry.projects[projectId]?.packs || [],
  };

  writeRegistry(registry);
  return registry.projects[projectId];
}

function listRegisteredProjects(excludeProjectId = null) {
  const registry = readRegistry();
  return Object.values(registry.projects || {}).filter(
    (project) => project.id !== excludeProjectId,
  );
}

function writeProjectStore(projectRoot, projectId, globalProjectDir) {
  const localFxmind = path.join(path.resolve(projectRoot), SHARED_DIR);
  fs.mkdirSync(localFxmind, { recursive: true });

  writeJson(path.join(localFxmind, STORE_FILE), {
    version: 1,
    mode: "global",
    projectId,
    projectRoot: path.resolve(projectRoot).replace(/\\/g, "/"),
    globalRoot: globalProjectDir.replace(/\\/g, "/"),
    sharedSkills: GLOBAL_SHARED_SKILLS.replace(/\\/g, "/"),
    registry: REGISTRY_PATH.replace(/\\/g, "/"),
    updatedAt: new Date().toISOString(),
  });
}

function removePathIfExists(targetPath) {
  if (!fs.existsSync(targetPath)) {
    return;
  }

  const stat = fs.lstatSync(targetPath);
  if (stat.isSymbolicLink() || stat.isFile()) {
    fs.unlinkSync(targetPath);
    return;
  }

  fs.rmSync(targetPath, { recursive: true, force: true });
}

function linkOrMirror(target, linkPath, type = "dir") {
  removePathIfExists(linkPath);
  fs.mkdirSync(path.dirname(linkPath), { recursive: true });

  const absTarget = path.resolve(target);
  if (!fs.existsSync(absTarget)) {
    return "missing";
  }

  try {
    if (type === "dir") {
      if (process.platform === "win32") {
        // junctions don't require Developer Mode/admin on Windows
        fs.symlinkSync(absTarget, linkPath, "junction");
      } else {
        fs.symlinkSync(absTarget, linkPath, "dir");
      }
    } else if (process.platform === "win32") {
      fs.symlinkSync(absTarget, linkPath, "file");
    } else {
      fs.symlinkSync(absTarget, linkPath, "file");
    }
    return "symlink";
  } catch {
    // Fallback (common on Windows without Developer Mode): mirror by copy.
    // NOTE: copies are not live — edits in .fxmind/memory/ will NOT flow back
    // to ~/.fxmind/projects/<id>/memory/. Run `fxmind --update -y` to re-sync,
    // or enable Windows Developer Mode for real symlinks.
    if (type === "dir") {
      fs.cpSync(absTarget, linkPath, { recursive: true, force: true });
    } else {
      fs.copyFileSync(absTarget, linkPath);
    }
    return "copy";
  }
}

function createSymlink(target, linkPath, type = "dir") {
  return linkOrMirror(target, linkPath, type);
}

/**
 * Copies into `globalDir` every file of `localDir` it lacks (recursively), and keeps a local file that differs
 * from the global one beside it as `<name>.local-<stamp><ext>`: nothing in a real local folder is lost when the
 * folder is replaced by a link. Global files are never overwritten and never deleted.
 */
function mergeIntoGlobal(localDir, globalDir, stamp, report) {
  fs.mkdirSync(globalDir, { recursive: true });
  for (const entry of fs.readdirSync(localDir, { withFileTypes: true })) {
    const from = path.join(localDir, entry.name);
    const to = path.join(globalDir, entry.name);
    if (entry.isDirectory()) {
      mergeIntoGlobal(from, to, stamp, report);
    } else if (entry.isFile()) {
      if (!fs.existsSync(to)) {
        fs.copyFileSync(from, to);
        report.copied += 1;
      } else if (!fs.readFileSync(from).equals(fs.readFileSync(to))) {
        const ext = path.extname(entry.name);
        const kept = path.join(globalDir, `${path.basename(entry.name, ext)}.local-${stamp}${ext}`);
        fs.copyFileSync(from, kept);
        report.conflicts.push(path.relative(globalDir, kept));
      }
    }
  }
}

function migrateLocalDataToGlobal(localFxmind, globalProjectDir) {
  fs.mkdirSync(globalProjectDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const report = { copied: 0, conflicts: [] };

  for (const name of PROJECT_DATA_LINKS) {
    const localPath = path.join(localFxmind, name);
    const globalPath = path.join(globalProjectDir, name);

    if (!fs.existsSync(localPath)) {
      continue;
    }

    const stat = fs.lstatSync(localPath);
    if (stat.isSymbolicLink()) {
      continue;
    }

    if (stat.isDirectory()) {
      // The local folder is replaced by a link next (wireProjectLinks). When the global folder already existed,
      // its files used to be skipped and then deleted with the folder; merge them first.
      if (!fs.existsSync(globalPath)) {
        fs.cpSync(localPath, globalPath, { recursive: true, force: true });
      } else {
        mergeIntoGlobal(localPath, globalPath, stamp, report);
      }
      continue;
    }

    if (!fs.existsSync(globalPath)) {
      fs.mkdirSync(path.dirname(globalPath), { recursive: true });
      fs.copyFileSync(localPath, globalPath);
    }
  }
  return report;
}

/**
 * Claude Code asks before every read of `.fxmind/memory` when it is a link into ~/.fxmind (outside the project).
 * The project's own global folder and the shared skills are added to `permissions.additionalDirectories` in
 * `.claude/settings.local.json`: per user and machine (the paths differ), never committed. Returns true if changed.
 */
function ensureClaudeStoreAccess(projectRoot) {
  const store = readStore(projectRoot);
  if (!(store?.mode === "global" && store.globalRoot)) return false;
  const dirs = [store.globalRoot, store.sharedSkills].filter(Boolean).map((dir) => path.resolve(dir).replace(/\\/g, "/"));
  const settingsPath = path.join(path.resolve(projectRoot), ".claude", "settings.local.json");
  let settings = {};
  if (fs.existsSync(settingsPath)) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, "utf8")) || {};
    } catch {
      return false; // never rewrite a file the person may be editing by hand
    }
  }
  const permissions = settings.permissions && typeof settings.permissions === "object" ? settings.permissions : {};
  const current = Array.isArray(permissions.additionalDirectories) ? permissions.additionalDirectories : [];
  const norm = (dir) => String(dir).replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  const missing = dirs.filter((dir) => !current.some((have) => norm(have) === norm(dir)));
  if (!missing.length) return false;
  settings.permissions = { ...permissions, additionalDirectories: [...current, ...missing] };
  writeJson(settingsPath, settings);
  return true;
}

/** Whether Claude Code may read the project's global folder without asking (see ensureClaudeStoreAccess). */
function claudeStoreAccessMissing(projectRoot) {
  const store = readStore(projectRoot);
  if (!(store?.mode === "global" && store.globalRoot)) return false;
  try {
    const settings = JSON.parse(fs.readFileSync(path.join(path.resolve(projectRoot), ".claude", "settings.local.json"), "utf8"));
    const have = (settings?.permissions?.additionalDirectories || []).map((dir) => String(dir).replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase());
    return !have.includes(path.resolve(store.globalRoot).replace(/\\/g, "/").toLowerCase());
  } catch {
    return true;
  }
}

function wireProjectLinks(projectRoot, globalProjectDir) {
  const localFxmind = path.join(path.resolve(projectRoot), SHARED_DIR);
  fs.mkdirSync(localFxmind, { recursive: true });
  fs.mkdirSync(globalProjectDir, { recursive: true });

  for (const stale of ["knowledge-graph.json", "knowledge-graph.html"]) {
    const stalePath = path.join(localFxmind, stale);
    if (fs.existsSync(stalePath)) {
      try {
        if (fs.lstatSync(stalePath).isSymbolicLink()) {
          fs.unlinkSync(stalePath);
        }
      } catch {
        // ignore
      }
    }
  }

  const linkModes = {};

  for (const name of PROJECT_DATA_LINKS) {
    const globalPath = path.join(globalProjectDir, name);
    const localPath = path.join(localFxmind, name);
    fs.mkdirSync(globalPath, { recursive: true });
    linkModes[name] = createSymlink(globalPath, localPath, "dir");
  }

  const sharedSkillsLink = path.join(localFxmind, "skills");
  fs.mkdirSync(GLOBAL_SHARED_SKILLS, { recursive: true });
  linkModes["skills"] = createSymlink(GLOBAL_SHARED_SKILLS, sharedSkillsLink, "dir");

  return linkModes;
}

function resolveDataRoot(projectRoot) {
  const store = readStore(projectRoot);
  if (store?.mode === "global" && store.globalRoot && fs.existsSync(store.globalRoot)) {
    return path.resolve(store.globalRoot);
  }

  return path.join(path.resolve(projectRoot), SHARED_DIR);
}

function resolveSkillsRoot(projectRoot) {
  const store = readStore(projectRoot);
  if (store?.mode === "global" && store.sharedSkills && fs.existsSync(store.sharedSkills)) {
    return path.resolve(store.sharedSkills);
  }

  return path.join(path.resolve(projectRoot), SHARED_DIR, "skills");
}

function resolveMemoryDir(projectRoot) {
  return path.join(resolveDataRoot(projectRoot), "memory");
}

function setupGlobalStore(projectRoot, meta = {}) {
  ensureGlobalDirs();
  const resolvedRoot = path.resolve(projectRoot);
  const projectId = projectIdForRoot(resolvedRoot);
  const globalProjectDir = getGlobalProjectDir(projectId);
  const localFxmind = path.join(resolvedRoot, SHARED_DIR);

  fs.mkdirSync(globalProjectDir, { recursive: true });
  migrateLayoutInDir(localFxmind);
  const merged = migrateLocalDataToGlobal(localFxmind, globalProjectDir);
  migrateLayoutInDir(globalProjectDir);
  registerProject(resolvedRoot, meta);
  writeProjectStore(resolvedRoot, projectId, globalProjectDir);
  const linkModes = wireProjectLinks(resolvedRoot, globalProjectDir);
  const copyFallbacks = Object.entries(linkModes)
    .filter(([, mode]) => mode === "copy")
    .map(([name]) => name);

  writeJson(path.join(globalProjectDir, "project.json"), {
    version: 1,
    projectId,
    name: meta.name || projectNameFromRoot(resolvedRoot),
    root: resolvedRoot.replace(/\\/g, "/"),
    linkModes,
    updatedAt: new Date().toISOString(),
  });

  return {
    projectId,
    globalProjectDir,
    sharedSkills: GLOBAL_SHARED_SKILLS,
    registryPath: REGISTRY_PATH,
    linkModes,
    copyFallbacks,
    merged,
  };
}

function loadForeignMemories(currentProjectId) {
  const foreign = [];

  for (const project of listRegisteredProjects(currentProjectId)) {
    const memoryDir = path.join(getGlobalProjectDir(project.id), "memory");
    if (!fs.existsSync(memoryDir)) {
      continue;
    }

    for (const entry of fs.readdirSync(memoryDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".md") || entry.name === "_index.md") {
        continue;
      }

      const slug = entry.name.replace(/\.md$/i, "").toLowerCase();
      const filePath = path.join(memoryDir, entry.name);
      foreign.push({
        projectId: project.id,
        projectName: project.name,
        projectRoot: project.root,
        slug,
        filePath,
        content: fs.readFileSync(filePath, "utf8"),
      });
    }
  }

  return foreign;
}

function printGlobalList() {
  const registry = readRegistry();
  const projects = Object.values(registry.projects || {});

  if (projects.length === 0) {
    console.log("No projects registered in global store.");
    console.log(`Registry: ${REGISTRY_PATH}`);
    return 0;
  }

  console.log(`Global fxmind store: ${GLOBAL_ROOT}\n`);
  for (const project of projects.sort((a, b) => a.name.localeCompare(b.name))) {
    console.log(`  ${project.name}`);
    console.log(`    id   → ${project.id}`);
    console.log(`    root → ${project.root}`);
    console.log(`    data → ${getGlobalProjectDir(project.id).replace(/\\/g, "/")}`);
    console.log("");
  }

  console.log(`Shared skills → ${GLOBAL_SHARED_SKILLS.replace(/\\/g, "/")}`);
  return 0;
}

function parseGlobalCliArgs(argv) {
  const options = { help: false };

  for (const arg of argv) {
    if (arg === "-h" || arg === "--help") {
      options.help = true;
    }
  }

  return options;
}

function printGlobalHelp() {
  console.log(`
Global fxmind store — one knowledge base per machine, isolated per project.

Layout:
  ~/.fxmind/registry.json           All registered projects
  ~/.fxmind/shared/skills/          Pack skills (shared across projects)
  ~/.fxmind/projects/<id>/memory/   Per-project memories
  ~/.fxmind/projects/<id>/          Per-project graph + metadata

Enable for a project:
  fxmind --global-store -y
  fxmind --global-store --update -y

Commands:
  fxmind global list                List registered projects
  fxmind global list -h             This help

Project .fxmind/store.json points to the global data dir. Agent paths stay .fxmind/memory/ via symlinks.
Cross-project links appear in fxmind graph when topics relate across projects.
`);
}

function runGlobalCli(argv = []) {
  const sub = argv[0];
  const rest = argv.slice(1);
  const options = parseGlobalCliArgs(rest);

  if (sub === "list") {
    if (options.help) {
      printGlobalHelp();
      return 0;
    }
    return printGlobalList();
  }

  printGlobalHelp();
  return sub ? 1 : 0;
}

module.exports = {
  ensureClaudeStoreAccess,
  claudeStoreAccessMissing,
  mergeIntoGlobal,
  SHARED_DIR,
  GLOBAL_ROOT,
  GLOBAL_SHARED_SKILLS,
  REGISTRY_PATH,
  projectIdForRoot,
  isGlobalStore,
  setupGlobalStore,
  resolveDataRoot,
  resolveSkillsRoot,
  resolveMemoryDir,
  readStore,
  registerProject,
  listRegisteredProjects,
  loadForeignMemories,
  getGlobalProjectDir,
  runGlobalCli,
  printGlobalHelp,
};
