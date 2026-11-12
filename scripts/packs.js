const fs = require("fs");
const os = require("os");
const path = require("path");

const PACKAGE_ROOT = path.join(__dirname, "..");
const PACKS_DIR = path.join(PACKAGE_ROOT, "packs");

/** Packs installed from other repositories with `fxmind pack add` (~/.fxmind/packs/<id>/). */
function externalPacksDir() {
  return process.env.FXMIND_PACKS_DIR || path.join(os.homedir(), ".fxmind", "packs");
}

function packIdsIn(dir) {
  if (!fs.existsSync(dir)) {
    return [];
  }
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .filter((id) => fs.existsSync(path.join(dir, id, "pack.json")));
}

/** Where a pack lives: the packs shipped with fxmind first, then the external ones. */
function packDirOf(packId) {
  for (const dir of [PACKS_DIR, externalPacksDir()]) {
    if (fs.existsSync(path.join(dir, packId, "pack.json"))) return path.join(dir, packId);
  }
  return null;
}

function loadPackManifest(packId) {
  const packDir = packDirOf(packId);
  if (!packDir) {
    throw new Error(`Unknown knowledge pack: ${packId}`);
  }

  const manifest = JSON.parse(fs.readFileSync(path.join(packDir, "pack.json"), "utf8"));
  return {
    ...manifest,
    id: packId,
    source: path.dirname(packDir) === PACKS_DIR ? "bundled" : "external",
    templatesDir: path.join(packDir, "templates"),
  };
}

function listPackIds() {
  return [...new Set([...packIdsIn(PACKS_DIR), ...packIdsIn(externalPacksDir())])].sort();
}

/** Ids of the packs shipped with fxmind: an external pack may not take one. */
function bundledPackIds() {
  return packIdsIn(PACKS_DIR).sort();
}

function listPacks() {
  return listPackIds().map(loadPackManifest);
}

function getPack(packId) {
  return loadPackManifest(packId);
}

/** Packs whose `detect.files` occur in the project root or up to three folders below it (resources/[group]/name). */
function detectPackIds(targetRoot) {
  if (!targetRoot || !fs.existsSync(targetRoot)) return [];
  const names = new Set();
  const walk = (dir, depth) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.isFile()) names.add(entry.name.toLowerCase());
      else if (entry.isDirectory() && depth < 3 && !/^(\.git|node_modules|\.fxmind)$/.test(entry.name)) {
        walk(path.join(dir, entry.name), depth + 1);
      }
    }
  };
  walk(targetRoot, 0);
  const found = listPacks().filter((pack) => (pack.detect?.files || [])
    .some((file) => names.has(String(file).toLowerCase())));
  // A FiveM server also carries package.json in NUI folders; FiveM wins.
  return found.some((pack) => pack.id === "fivem") ? ["fivem"] : found.map((pack) => pack.id);
}

function getDefaultPackIds(targetRoot) {
  const detected = detectPackIds(targetRoot);
  return detected.length ? detected : ["fivem"];
}

/** Pack ids recorded for an installed project (`.fxmind/packs.json`). */
function installedPackIds(targetRoot) {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(targetRoot, ".fxmind", "packs.json"), "utf8"));
    const ids = (Array.isArray(manifest.packs) ? manifest.packs : [])
      .map((pack) => (typeof pack === "string" ? pack : pack?.id))
      .filter(Boolean);
    if (ids.length) return ids;
  } catch { /* fall through to legacy detection */ }
  // Projects installed before packs.json listed packs: the FiveM policy marks them.
  return fs.existsSync(path.join(targetRoot, ".fxmind", "policy", "fivem-principles.md")) ? ["fivem"] : [];
}

/** Installed pack manifests, skipping ids this fxmind version does not ship. */
function installedPacks(targetRoot) {
  return installedPackIds(targetRoot).flatMap((id) => {
    try { return [getPack(id)]; } catch { return []; }
  });
}

function getDefaultSkillsForPacks(packIds) {
  const skills = new Set();
  for (const packId of packIds) {
    for (const skill of getPack(packId).defaultSkills || []) {
      skills.add(skill);
    }
  }
  return [...skills];
}

function validatePackIds(packIds) {
  const available = new Set(listPackIds());
  for (const packId of packIds) {
    if (!available.has(packId)) {
      throw new Error(
        `Unknown pack: ${packId}. Available: ${[...available].join(", ")}`,
      );
    }
  }
}

module.exports = {
  PACKAGE_ROOT,
  PACKS_DIR,
  externalPacksDir,
  bundledPackIds,
  packDirOf,
  listPackIds,
  listPacks,
  getPack,
  getDefaultPackIds,
  detectPackIds,
  installedPackIds,
  installedPacks,
  getDefaultSkillsForPacks,
  validatePackIds,
};
