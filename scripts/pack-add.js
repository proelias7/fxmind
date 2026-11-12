/**
 * fxmind pack add | remove — knowledge packs from other repositories.
 *
 * A pack is fetched (git clone --depth 1, or a local folder), checked, and its
 * files copied to ~/.fxmind/packs/<id>/. Nothing from the pack is executed:
 * only pack.json and Markdown (.md, .mdc) files are accepted.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const { externalPacksDir, bundledPackIds } = require("./packs");

const ID_RE = /^[a-z0-9][a-z0-9-]*$/;
const ALLOWED_EXT = new Set([".md", ".mdc"]);
const SOURCES_FILE = ".sources.json";

/** owner/repo, a git URL, or a local folder. */
function parseSource(input, cwd = process.cwd()) {
  const raw = String(input || "").trim();
  if (!raw) throw new Error("Missing pack source. Use owner/repo, a git URL or a local folder.");
  if (/^(https?:\/\/|ssh:\/\/|git:\/\/|file:\/\/|git@[^:]+:)/.test(raw)) {
    return { kind: "git", url: raw, label: raw };
  }
  const local = path.resolve(cwd, raw);
  if (fs.existsSync(local) && fs.statSync(local).isDirectory()) {
    return { kind: "local", dir: local, label: local };
  }
  const short = raw.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/);
  if (short) {
    return { kind: "git", url: `https://github.com/${short[1]}/${short[2]}.git`, label: `${short[1]}/${short[2]}` };
  }
  throw new Error(`Unknown pack source "${raw}". Use owner/repo, a git URL or a local folder.`);
}

/** The pack's folder on disk, and a cleanup for what was fetched. */
function fetchSource(source, { ref, subpath } = {}) {
  let root = source.dir;
  let cleanup = () => {};
  if (source.kind === "git") {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fxmind-pack-"));
    cleanup = () => fs.rmSync(tmp, { recursive: true, force: true });
    const args = ["clone", "--depth", "1", ...(ref ? ["--branch", ref] : []), "--", source.url, path.join(tmp, "repo")];
    try {
      execFileSync("git", args, { stdio: "pipe", env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
    } catch (error) {
      cleanup();
      const why = String(error.stderr || error.message).trim().split("\n").pop();
      throw new Error(`Could not clone ${source.label}${ref ? ` at ${ref}` : ""}: ${why}`);
    }
    root = path.join(tmp, "repo");
  }
  const dir = subpath ? path.resolve(root, subpath) : root;
  if (path.relative(root, dir).startsWith("..")) {
    cleanup();
    throw new Error(`--path must stay inside the source: ${subpath}`);
  }
  if (!fs.existsSync(dir)) {
    cleanup();
    throw new Error(`No folder ${subpath} in ${source.label}.`);
  }
  return { dir, cleanup };
}

/** Every file of the pack, relative and with forward slashes; .git is skipped. */
function listFiles(dir, base = dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".git") continue;
    const full = path.join(dir, entry.name);
    const rel = path.relative(base, full).replace(/\\/g, "/");
    if (entry.isSymbolicLink()) out.push({ rel, link: true });
    else if (entry.isDirectory()) listFiles(full, base, out);
    else out.push({ rel });
  }
  return out;
}

const insideRel = (rel) => typeof rel === "string" && rel.length > 0 && !path.isAbsolute(rel) && !rel.split(/[\\/]/).includes("..");

/**
 * Checks a pack folder. Returns { manifest, files } or throws one error listing every problem found,
 * so the author fixes them in one go.
 */
function validatePack(dir) {
  const problems = [];
  const manifestPath = path.join(dir, "pack.json");
  let manifest = null;
  if (!fs.existsSync(manifestPath)) {
    problems.push("pack.json is missing at the pack's root");
  } else {
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    } catch (error) {
      problems.push(`pack.json is not valid JSON: ${error.message}`);
    }
  }

  const files = listFiles(dir);
  for (const file of files) {
    if (file.link) problems.push(`${file.rel}: symbolic links are not allowed`);
    else if (file.rel !== "pack.json" && !ALLOWED_EXT.has(path.extname(file.rel).toLowerCase())) {
      problems.push(`${file.rel}: not allowed (a pack holds only pack.json and .md or .mdc files)`);
    }
  }

  if (manifest && typeof manifest === "object") {
    const text = (key) => typeof manifest[key] === "string" && manifest[key].trim();
    if (!text("id")) problems.push('pack.json: "id" is required');
    else if (!ID_RE.test(manifest.id)) problems.push(`pack.json: "id" must be lowercase letters, digits and hyphens (got "${manifest.id}")`);
    else if (bundledPackIds().includes(manifest.id)) problems.push(`pack.json: "id" ${manifest.id} is a pack shipped with fxmind; pick another id`);
    if (!text("label")) problems.push('pack.json: "label" is required');
    if (!text("description")) problems.push('pack.json: "description" is required');

    const skills = manifest.skills;
    let skillsDir = null;
    if (!skills || typeof skills !== "object") {
      problems.push('pack.json: "skills" is required, with "localPath" (skills inside the pack) or "repo" (a git URL)');
    } else if (skills.localPath !== undefined) {
      if (!insideRel(skills.localPath)) problems.push('pack.json: "skills.localPath" must be a relative path inside the pack');
      else if (!fs.existsSync(path.join(dir, skills.localPath))) problems.push(`pack.json: "skills.localPath" ${skills.localPath} does not exist`);
      else skillsDir = path.join(dir, skills.localPath);
    } else if (typeof skills.repo !== "string" || !/^(https?:\/\/|ssh:\/\/|git@)/.test(skills.repo)) {
      problems.push('pack.json: "skills" needs "localPath" or a git URL in "repo"');
    } else if (!skills.cacheName || !ID_RE.test(String(skills.cacheName))) {
      problems.push('pack.json: "skills.cacheName" is required with "skills.repo" (lowercase letters, digits, hyphens)');
    }

    if (!Array.isArray(manifest.defaultSkills) || manifest.defaultSkills.some((name) => typeof name !== "string" || !ID_RE.test(name))) {
      problems.push('pack.json: "defaultSkills" must be a list of skill folder names');
    } else if (skillsDir) {
      for (const name of manifest.defaultSkills) {
        if (!fs.existsSync(path.join(skillsDir, name, "SKILL.md"))) problems.push(`pack.json: default skill ${name} has no ${skills.localPath}/${name}/SKILL.md`);
      }
    }

    if (manifest.templateFiles !== undefined) {
      if (!Array.isArray(manifest.templateFiles)) problems.push('pack.json: "templateFiles" must be a list of { "src", "dest" }');
      else {
        for (const entry of manifest.templateFiles) {
          if (!entry || !insideRel(entry.src) || !insideRel(entry.dest)) {
            problems.push(`pack.json: templateFiles entry ${JSON.stringify(entry)} needs relative "src" and "dest" paths`);
          } else if (!fs.existsSync(path.join(dir, "templates", entry.src))) {
            problems.push(`pack.json: template ${entry.src} is missing from templates/`);
          }
        }
      }
    }

    const reviewFiles = [];
    const review = manifest.review || {};
    for (const entry of [...(review.policy || []), ...(review.always || []), ...(review.rules || []).flatMap((rule) => rule?.files || [])]) {
      reviewFiles.push(typeof entry === "string" ? entry : entry?.file);
    }
    for (const file of reviewFiles) {
      if (!insideRel(file)) problems.push(`pack.json: review file ${JSON.stringify(file)} must be a relative path`);
    }
  } else if (manifest !== null) {
    problems.push("pack.json must hold a JSON object");
  }

  if (problems.length) {
    const error = new Error(`Invalid pack:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    error.problems = problems;
    throw error;
  }
  return { manifest, files: files.map((file) => file.rel) };
}

function readSources(packsDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(packsDir, SOURCES_FILE), "utf8"));
  } catch {
    return {};
  }
}

function writeSources(packsDir, sources) {
  fs.writeFileSync(path.join(packsDir, SOURCES_FILE), `${JSON.stringify(sources, null, 2)}\n`, "utf8");
}

/**
 * Installs a pack. `confirm(id)` is asked when that id is already installed; without a yes nothing changes.
 * Resolves to { status: "installed", id, dir } or { status: "kept", id, dir }.
 */
async function addPack(input, options = {}) {
  const packsDir = options.packsDir || externalPacksDir();
  const source = parseSource(input, options.cwd);
  const fetched = fetchSource(source, { ref: options.ref, subpath: options.path });
  try {
    const { manifest, files } = validatePack(fetched.dir);
    const dest = path.join(packsDir, manifest.id);
    if (fs.existsSync(dest)) {
      const yes = options.force || (options.confirm ? await options.confirm(manifest.id, dest) : false);
      if (!yes) return { status: "kept", id: manifest.id, dir: dest };
      fs.rmSync(dest, { recursive: true, force: true });
    }
    for (const rel of files) {
      const to = path.join(dest, rel);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(path.join(fetched.dir, rel), to);
    }
    const sources = readSources(packsDir);
    sources[manifest.id] = { source: source.label, ...(options.ref ? { ref: options.ref } : {}), ...(options.path ? { path: options.path } : {}), installedAt: new Date().toISOString() };
    writeSources(packsDir, sources);
    return { status: "installed", id: manifest.id, dir: dest };
  } finally {
    fetched.cleanup();
  }
}

/** Removes an external pack; a pack shipped with fxmind cannot be removed. */
async function removePack(id, options = {}) {
  const packsDir = options.packsDir || externalPacksDir();
  if (bundledPackIds().includes(id)) throw new Error(`${id} ships with fxmind and cannot be removed.`);
  const dir = path.join(packsDir, id);
  if (!ID_RE.test(String(id)) || !fs.existsSync(path.join(dir, "pack.json"))) throw new Error(`No external pack ${id} in ${packsDir}.`);
  const yes = options.force || (options.confirm ? await options.confirm(id, dir) : false);
  if (!yes) return { status: "kept", id, dir };
  fs.rmSync(dir, { recursive: true, force: true });
  const sources = readSources(packsDir);
  delete sources[id];
  writeSources(packsDir, sources);
  return { status: "removed", id, dir };
}

/** A y/N question on the terminal; anything but y or yes is a no. */
function askYesNo(question) {
  return new Promise((resolve) => {
    const rl = require("readline").createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`${question} [y/N] `, (answer) => {
      rl.close();
      resolve(/^(y|yes|s|sim)$/i.test(answer.trim()));
    });
  });
}

/** The terminal asks; without one, only --force overwrites. */
function terminalConfirm(what) {
  return async (id, dir) => {
    if (!process.stdin.isTTY) {
      console.error(`${id} is already installed at ${dir}. Run again with --force to ${what} it.`);
      return false;
    }
    return askYesNo(`${id} is already installed at ${dir}. ${what[0].toUpperCase()}${what.slice(1)} it?`);
  };
}

function parseAddArgs(argv) {
  const options = { positional: [], ref: null, path: null, force: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--ref") options.ref = argv[++i];
    else if (arg === "--path") options.path = argv[++i];
    else if (arg === "--force" || arg === "-f") options.force = true;
    else if (!arg.startsWith("-")) options.positional.push(arg);
    else throw new Error(`Unknown option ${arg}`);
  }
  return options;
}

async function runPackAdd(argv) {
  let options;
  try {
    options = parseAddArgs(argv);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    return 1;
  }
  if (!options.positional[0]) {
    console.error("Error: `pack add` needs a source. Example: fxmind pack add owner/repo");
    return 1;
  }
  try {
    const result = await addPack(options.positional[0], { ...options, confirm: terminalConfirm("overwrite") });
    if (result.status === "kept") {
      console.log(`Nothing changed: ${result.id} stays as it was at ${result.dir}.`);
      return 1;
    }
    console.log(`Installed pack ${result.id} at ${result.dir}`);
    console.log(`Use it in a project with: fxmind --pack ${result.id} -y`);
    return 0;
  } catch (error) {
    console.error(`Error: ${error.message}`);
    return 1;
  }
}

async function runPackRemove(argv) {
  let options;
  try {
    options = parseAddArgs(argv);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    return 1;
  }
  const id = options.positional[0];
  if (!id) {
    console.error("Error: `pack remove` needs a pack id.");
    return 1;
  }
  try {
    const result = await removePack(id, { force: options.force, confirm: terminalConfirm("remove") });
    if (result.status === "kept") {
      console.log(`Nothing changed: ${id} stays at ${result.dir}.`);
      return 1;
    }
    console.log(`Removed pack ${id} from ${result.dir}`);
    return 0;
  } catch (error) {
    console.error(`Error: ${error.message}`);
    return 1;
  }
}

module.exports = {
  parseSource,
  validatePack,
  addPack,
  removePack,
  readSources,
  runPackAdd,
  runPackRemove,
};
