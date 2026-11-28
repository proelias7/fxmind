/**
 * Skills over MCP (io.modelcontextprotocol/skills, MCP 2026-07-28).
 *
 * Serves the pack skills installed for this project (.fxmind/skills/, or the
 * global shared store) so clients load them on demand from the server
 * instead of copies in every agent folder. The installed copy is the source
 * because fxmind_record_correction edits it in place.
 *
 * URIs: skill://fxmind/<skill-name>/<file-path>. The skill-name segment
 * equals the frontmatter name (spec), so a relative link such as
 * ../web-development/api.md inside web-backend/SKILL.md resolves to the
 * sibling skill's file.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const URI_PREFIX = "skill://fxmind/";
const SKILL_FILE = "SKILL.md";
// Spec-recommended per-skill limits.
const MAX_FILES = 512;
const MAX_BYTES = 16 * 1024 * 1024;

const TEXT_MIME = {
  ".md": "text/markdown",
  ".mdc": "text/markdown",
  ".txt": "text/plain",
  ".json": "application/json",
  ".yaml": "application/yaml",
  ".yml": "application/yaml",
  ".js": "text/javascript",
  ".ts": "text/plain",
  ".lua": "text/plain",
  ".html": "text/html",
  ".css": "text/css",
  ".sql": "text/plain",
  ".sh": "text/plain",
};
const BINARY_MIME = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
};

function skillsRoot(root) {
  const { isGlobalStore, GLOBAL_SHARED_SKILLS } = require("../global-store");
  const { PACK_SKILLS_DIR } = require("../install/config");
  try {
    if (isGlobalStore(root)) return GLOBAL_SHARED_SKILLS;
  } catch {
    // Unreadable store file: fall back to the project copy.
  }
  return path.join(root, PACK_SKILLS_DIR);
}

/** Minimal YAML frontmatter reader: `key: value` plus folded/literal blocks. */
function parseFrontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!match) return {};
  const out = {};
  const lines = match[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(lines[i]);
    if (!kv) continue;
    let value = kv[2].trim();
    if (value === ">" || value === "|" || value === ">-" || value === "|-") {
      const block = [];
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) block.push(lines[++i].trim());
      value = block.join(value.startsWith(">") ? " " : "\n");
    } else if (/^(["']).*\1$/.test(value)) {
      value = value.slice(1, -1);
    }
    out[kv[1]] = value;
  }
  return out;
}

function walkFiles(dir, rel = "") {
  const files = [];
  for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const childRel = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...walkFiles(dir, childRel));
    else if (entry.isFile()) files.push(childRel);
  }
  return files;
}

function digestOf(buffer) {
  return `sha256:${crypto.createHash("sha256").update(buffer).digest("hex")}`;
}

/** Reads one installed skill directory into a spec skill entry, or null. */
function readSkill(dir) {
  let skillText;
  try {
    skillText = fs.readFileSync(path.join(dir, SKILL_FILE), "utf8");
  } catch {
    return null;
  }
  const dirName = path.basename(dir);
  const frontmatter = parseFrontmatter(skillText);
  // The last URI segment MUST equal the frontmatter name; skip skills whose
  // name would break that (the directory name is what links resolve against).
  if (frontmatter.name && frontmatter.name !== dirName) return null;
  frontmatter.name = dirName;
  if (!frontmatter.description) frontmatter.description = "";

  const resources = [];
  let total = 0;
  const files = walkFiles(dir).sort((a, b) => (a === SKILL_FILE ? -1 : b === SKILL_FILE ? 1 : a.localeCompare(b)));
  for (const rel of files.slice(0, MAX_FILES)) {
    const buffer = fs.readFileSync(path.join(dir, rel));
    total += buffer.length;
    if (total > MAX_BYTES) break;
    resources.push({ uri: `${URI_PREFIX}${dirName}/${rel}`, digest: digestOf(buffer), size: buffer.length });
  }
  return { uri: `${URI_PREFIX}${dirName}/${SKILL_FILE}`, frontmatter, resources };
}

function listSkills(root) {
  const base = skillsRoot(root);
  let entries;
  try {
    entries = fs.readdirSync(base, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => readSkill(path.join(base, entry.name)))
    .filter(Boolean)
    .sort((a, b) => a.frontmatter.name.localeCompare(b.frontmatter.name));
}

/** Splits skill://fxmind/<name>/<file> into a safe on-disk path, or null. */
function resolveUri(root, uri) {
  if (typeof uri !== "string" || !uri.startsWith(URI_PREFIX)) return null;
  const rest = uri.slice(URI_PREFIX.length);
  const slash = rest.indexOf("/");
  if (slash <= 0) return null;
  const name = rest.slice(0, slash);
  let rel;
  try {
    rel = decodeURIComponent(rest.slice(slash + 1));
  } catch {
    return null;
  }
  if (!/^[A-Za-z0-9._-]+$/.test(name) || name.startsWith(".") || !rel) return null;
  const parts = rel.split("/");
  if (parts.some((part) => !part || part === "." || part === ".." || part.startsWith(".") || part.includes("\\"))) {
    return null;
  }
  const skillDir = path.join(skillsRoot(root), name);
  const file = path.join(skillDir, ...parts);
  if (!file.startsWith(skillDir + path.sep)) return null;
  return { name, rel, skillDir, file };
}

function getSkill(root, uri) {
  const target = resolveUri(root, uri);
  if (!target || target.rel !== SKILL_FILE) return null;
  return readSkill(target.skillDir);
}

/** resources/read contents for a skill file, or null when it is not one. */
function readSkillResource(root, uri) {
  const target = resolveUri(root, uri);
  if (!target) return null;
  if (!fs.existsSync(path.join(target.skillDir, SKILL_FILE))) return null;
  let buffer;
  try {
    // Refuse symlinks that escape the skill directory.
    const real = fs.realpathSync(target.file);
    const realDir = fs.realpathSync(target.skillDir);
    if (!real.startsWith(realDir + path.sep)) return null;
    if (!fs.statSync(real).isFile()) return null;
    buffer = fs.readFileSync(real);
  } catch {
    return null;
  }
  const ext = path.extname(target.file).toLowerCase();
  if (BINARY_MIME[ext]) {
    return { uri, mimeType: BINARY_MIME[ext], blob: buffer.toString("base64") };
  }
  return { uri, mimeType: TEXT_MIME[ext] || "text/plain", text: buffer.toString("utf8") };
}

module.exports = {
  URI_PREFIX,
  skillsRoot,
  parseFrontmatter,
  listSkills,
  getSkill,
  readSkillResource,
};
