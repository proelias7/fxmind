"use strict";
/**
 * Atomic, provenance-backed code and memory graph. No LLM or network required.
 * Files are indexed incrementally; existing topic Markdown is never rewritten.
 * In global-store mode the generated index lives in ~/.fxmind/projects/<id>/graph.
 */
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { resolveDataRoot, resolveMemoryDir } = require("../global-store");
const retrieval = require("./memory-retrieval");
const { withFileLock } = require("./fs-lock");

const VERSION = 4;
const MAX_SOURCE_FILES = 12000;
const MAX_SOURCE_BYTES = 350 * 1024;
const MAX_LINES = 18000;
const ROOT_FOLDERS = ["resources", "src", "scripts", "server", "client", "shared", "modules", "apps"];
const SKIP_DIRS = new Set([".git", ".fxmind", "node_modules", "dist", "build", "vendor", "cache", "stream", "html", ".next", "coverage", "__pycache__"]);
const SOURCE_EXT = new Set([".lua", ".js", ".jsx", ".ts", ".tsx", ".sql", ".py"]);
const SECRET_LINE = /(?:secret|private[_-]?key|api[_-]?key|password|bearer|access[_-]?token)\s*[:=]/i;
const CODE_PATTERNS = [
  ["function", /\b(?:local\s+)?function\s+([A-Za-z_][\w.:]*)\s*\(/g],
  ["function", /\b(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_][\w]*)\s*\(/g],
  ["function", /\b(?:const|let)\s+([A-Za-z_][\w]*)\s*=\s*(?:async\s*)?(?:function\s*\(|\([^)]*\)\s*=>)/g],
  ["event", /\b(?:RegisterNetEvent|RegisterServerEvent|AddEventHandler|onNet)\s*\(\s*["']([\w:.-]+)["']/g, "handler"],
  ["event", /\b(?:TriggerServerEvent|TriggerClientEvent|TriggerLatentServerEvent|TriggerLatentClientEvent|TriggerEvent|emitNet)\s*\(\s*["']([\w:.-]+)["']/g, "emitter"],
  ["command", /\bRegisterCommand\s*\(\s*["']([\w:.-]+)["']/g],
  ["export", /\bexports\s*\(\s*["']([\w:.-]+)["']/g],
  // exports['res']:fn(  exports.res:fn(  exports.res.fn(  exports["res"].fn(
  ["export-call", /\bexports\s*(?:\[\s*["']([\w-]+)["']\s*\]|\.([\w-]+))\s*[:.]\s*([A-Za-z_]\w*)\s*\(/g, "usage"],
  ["sql-table", /\b(?:FROM|JOIN|INTO|UPDATE|TABLE)\s+["'\x60]?([A-Za-z_][\w]*)/gi],
];
// Call sites are collected per enclosing scope (function, handler or command
// body) and resolved to definitions after every file is indexed.
const CALL_RE = /(?<![\w.:])([A-Za-z_]\w*(?:[.:][A-Za-z_]\w*)*)\s*\(/g;
const CALL_SKIP = new Set(("if elseif while for return local function and or not then do end else repeat until in " +
  "new typeof await async switch catch const let var print require pairs ipairs tostring tonumber type next " +
  "select error assert pcall xpcall setmetatable getmetatable rawget rawset unpack table.insert table.remove " +
  "table.concat table.sort table.unpack string.format string.sub string.find string.match string.gsub " +
  "string.lower string.upper math.floor math.ceil math.random math.max math.min math.abs json.encode json.decode " +
  "console.log Citizen.Wait Citizen.CreateThread CreateThread Wait SetTimeout setTimeout setInterval " +
  "RegisterNetEvent RegisterServerEvent AddEventHandler TriggerServerEvent TriggerClientEvent TriggerEvent " +
  "TriggerLatentServerEvent TriggerLatentClientEvent RegisterCommand onNet emitNet exports").split(/\s+/));
const MAX_CALLS_PER_SCOPE = 40;

function idFor(prefix, value) {
  return prefix + ":" + crypto.createHash("sha256").update(value).digest("hex").slice(0, 18);
}
function asUnix(file) { return String(file).replace(/\\/g, "/"); }
function indexPath(root) { return path.join(resolveDataRoot(root), "graph", "atomic-index.json"); }
function safeReadJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}
function readAtomic(root) {
  const data = safeReadJson(indexPath(root));
  return data && data.version === VERSION ? data : null;
}
// Keep query state bounded in long-lived MCP servers; other readers stay fresh.
const QUERY_INDEXES = new Map();
const NODE_FIELDS = new WeakMap();
function readQueryIndex(root) {
  const file = indexPath(root);
  try {
    const stat = fs.statSync(file, { bigint: true });
    const cached = QUERY_INDEXES.get(file);
    if (cached && ["size", "mtimeNs", "ctimeNs", "ino"].every((key) => cached.stat[key] === stat[key])) {
      QUERY_INDEXES.delete(file);
      QUERY_INDEXES.set(file, cached);
      return cached.index;
    }
    QUERY_INDEXES.delete(file);
    const index = readAtomic(root);
    if (!index) return null;
    QUERY_INDEXES.set(file, { stat, index });
    if (QUERY_INDEXES.size > 2) QUERY_INDEXES.delete(QUERY_INDEXES.keys().next().value);
    return index;
  } catch {
    QUERY_INDEXES.delete(file);
    return null;
  }
}
function resourceFor(rel) {
  const parts = asUnix(rel).split("/");
  const i = parts.findIndex((p) => p.toLowerCase() === "resources");
  if (i >= 0 && parts[i + 2]) return parts[i + 2].replace(/^\[|\]$/g, "").toLowerCase();
  return parts[0] && !/^(src|scripts|server|client|shared|modules|apps)$/i.test(parts[0])
    ? parts[0].toLowerCase() : path.basename(parts[0] || "project", path.extname(parts[0] || ""));
}
function sourceCandidates(root) {
  const roots = ROOT_FOLDERS.map((name) => path.join(root, name)).filter((p) => fs.existsSync(p));
  const stack = roots.length ? roots : [root];
  const found = [];
  let visited = 0;
  while (stack.length && found.length < MAX_SOURCE_FILES && visited < 120000) {
    const folder = stack.pop();
    let entries;
    try { entries = fs.readdirSync(folder, { withFileTypes: true }); } catch { continue; }
    visited += entries.length;
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const full = path.join(folder, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name.toLowerCase())) stack.push(full);
      } else if (entry.isFile() && SOURCE_EXT.has(path.extname(entry.name).toLowerCase())) {
        found.push(full);
        if (found.length >= MAX_SOURCE_FILES) break;
      }
    }
  }
  return found.sort();
}
function cleanEvidence(line) {
  const value = String(line || "").trim().slice(0, 240);
  return SECRET_LINE.test(value) ? "[linha potencialmente sensível omitida]" : value;
}
function stripStrings(line) {
  return line.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g, '""');
}
function sourceNodes(root, rel, content, digest) {
  const lines = content.split(/\r?\n/);
  const resource = resourceFor(rel);
  const nodes = [];
  const used = new Map();
  let scope = null;
  for (let i = 0; i < Math.min(lines.length, MAX_LINES); i++) {
    const line = lines[i];
    if (!line || line.length > 1000 || /^\s*(?:--|\/\/|#|\*)/.test(line)) continue;
    // A top-level `end` / `}` closes the current scope (Lua and JS bodies).
    if (scope && /^(?:end|\})\s*\)?\s*[,;]?\s*$/.test(line)) { scope = null; continue; }
    let opened = null;
    const lineNodes = [];
    for (const [kind, re, role] of CODE_PATTERNS) {
      re.lastIndex = 0;
      let match;
      while ((match = re.exec(line))) {
        const name = kind === "export-call" ? match[3] : match[1];
        if (!name || name.length > 100) continue;
        // Overlapping patterns (`local function x(` matches two) yield one node.
        if (lineNodes.some((n) => n.kind === kind && n.name === name && n.role === role)) continue;
        const key = kind + ":" + name + (role === "emitter" ? ":emit" : "");
        const ordinal = (used.get(key) || 0) + 1;
        used.set(key, ordinal);
        if (nodes.length >= 160) break;
        let evidence = cleanEvidence(line);
        if (kind === "function") {
          const excerpt = [evidence];
          for (let next = i + 1; next < Math.min(lines.length, i + 12); next++) {
            if (/^\s*(?:local\s+function|function|RegisterNetEvent|AddEventHandler|RegisterCommand)\b/.test(lines[next])) break;
            excerpt.push(cleanEvidence(lines[next]));
            if (/^\s*(?:end|})\s*[,;]?\s*$/.test(lines[next])) break;
          }
          evidence = excerpt.filter(Boolean).join("\n").slice(0, 680);
        }
        const node = {
          id: idFor("code", rel + "|" + key + "|" + ordinal),
          name, kind, group: "code-symbol", resource,
          file: rel, line: i + 1, sourceHash: digest,
          source: "code", confidence: "extracted",
          content: evidence, topic: resource,
        };
        if (role) node.role = role;
        if (kind === "export-call") node._target = String(match[1] || match[2] || "").toLowerCase();
        nodes.push(node);
        lineNodes.push(node);
        const opensBody = kind === "function" ||
          ((role === "handler" || kind === "command") && /\bfunction\b|=>/.test(line));
        if (opensBody && !opened) opened = node;
      }
    }
    for (const node of lineNodes) {
      if ((node.role === "emitter" || node.role === "usage") && (opened || scope) && (opened || scope) !== node) {
        node._scope = (opened || scope).id;
      }
    }
    if (opened) { scope = opened; scope._calls = []; }
    if (scope && scope._calls.length < MAX_CALLS_PER_SCOPE) {
      const code = stripStrings(line);
      CALL_RE.lastIndex = 0;
      let call;
      while ((call = CALL_RE.exec(code))) {
        const name = call[1];
        if (CALL_SKIP.has(name) || CALL_SKIP.has(name.split(/[.:]/)[0]) || name === scope.name) continue;
        if (/\bfunction\s+$/.test(code.slice(0, call.index))) continue;
        if (!scope._calls.includes(name)) scope._calls.push(name);
        if (scope._calls.length >= MAX_CALLS_PER_SCOPE) break;
      }
    }
    if (nodes.length >= 160) break;
  }
  for (const node of nodes) if (node._calls && !node._calls.length) delete node._calls;
  return nodes;
}
function parseMeta(content) {
  const raw = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!raw) return {};
  const out = {};
  let active = "";
  for (const line of raw[1].split(/\r?\n/)) {
    const field = line.match(/^([A-Za-z_-]+):\s*(.*?)\s*$/);
    if (field) {
      active = field[1].toLowerCase();
      const value = field[2].replace(/^\[|\]$/g, "");
      out[active] = value ? value.split(/\s*,\s*/).filter(Boolean) : [];
    } else if (active && /^\s*-\s+/.test(line)) {
      out[active].push(line.replace(/^\s*-\s+/, "").trim());
    }
  }
  return out;
}
function fragments(section) {
  const text = section.text || "";
  const heading = section.heading.replace(/^#+\s*/, "").replace(/[*:]+$/, "").trim();
  const blocks = [];
  for (const paragraph of text.split(/\n\s*\n/)) {
    const units = /^\s*[-*]\s/m.test(paragraph)
      ? paragraph.split(/\r?\n/).filter((line) => line.trim() && !/^\s*#{1,6}\s/.test(line))
      : [paragraph.replace(/^\s*#{1,6}\s.*?\r?\n/, "")];
    for (const unit of units) {
      const value = unit.trim();
      if (!value || value === section.heading || /^#{1,6}\s/.test(value)) continue;
      for (let start = 0; start < value.length; start += 600) {
        const piece = value.slice(start, start + 600).trim();
        if (piece) blocks.push({ heading, text: piece });
      }
    }
  }
  return blocks;
}
function memoryNodes(rel, content, digest) {
  const meta = parseMeta(content);
  const slug = path.basename(rel, ".md").toLowerCase();
  const topic = meta.topic?.[0] || slug;
  const body = retrieval.splitFrontmatter(content);
  const resource = meta.resources?.[0] || resourceFor(meta.paths?.[0] || slug);
  const nodes = [];
  let sequence = 0;
  for (const section of retrieval.splitSections(body)) {
    for (const frag of fragments(section)) {
      if (nodes.length >= 250) break;
      sequence++;
      const label = frag.heading && frag.heading.toLowerCase() !== topic.toLowerCase() ? frag.heading : topic;
      const offset = content.indexOf(frag.text);
      const sourceLine = offset >= 0 ? content.slice(0, offset).split(/\r?\n/).length : null;
      nodes.push({
        id: idFor("memory", rel + "|" + sequence + "|" + frag.text),
        name: label, kind: "fact", group: "memory-atom", resource,
        topic, slug, file: rel, line: sourceLine, sourceHash: digest,
        source: "memory", confidence: meta.confidence?.[0] || "documented",
        content: frag.text,
        sourcePaths: meta.paths || [],
        paths: (meta.paths || []).filter((p) => frag.text.includes(p)),
        symbols: (meta.symbols || []).filter((name) =>
          (frag.text + " " + frag.heading).toLowerCase().includes(name.toLowerCase())),
        events: [
          ...(meta.events || []).filter((name) => frag.text.toLowerCase().includes(name.toLowerCase())),
          ...[...frag.text.matchAll(/\b[a-zA-Z_][\w-]*:[a-zA-Z_][\w:-]*/g)].map((match) => match[0]),
        ],
        triggers: (meta.triggers || []).filter((name) =>
          frag.text.toLowerCase().includes(name.toLowerCase())),
      });
    }
  }
  return nodes;
}
function fileEntry(root, abs, prior, isMemory) {
  const stat = fs.statSync(abs);
  if (!stat.isFile() || stat.size > (isMemory ? 1024 * 1024 : MAX_SOURCE_BYTES)) return null;
  const rel = isMemory ? ".fxmind/memory/" + path.basename(abs) : asUnix(path.relative(root, abs));
  if (prior && prior.size === stat.size && prior.mtimeMs === stat.mtimeMs) return prior;
  const content = fs.readFileSync(abs, "utf8");
  const digest = crypto.createHash("sha256").update(content).digest("hex");
  return {
    size: stat.size, mtimeMs: stat.mtimeMs, sourceHash: digest,
    nodes: isMemory ? memoryNodes(rel, content, digest) : sourceNodes(root, rel, content, digest),
  };
}
/**
 * Directed code-flow edges, resolved conservatively (an ambiguous target is
 * never guessed):
 *   emitter event  --handled-by-->   handler of the same event name
 *   scope          --emits-->        emitter event inside its body
 *   scope          --uses-export-->  exports['res']:fn() call inside its body
 *   scope          --calls-->        function definition it calls
 *   export call    --calls-export--> exports("name", ...) definition
 * Same-file/explicit targets are "extracted"; cross-file ones "inferred" with a score.
 */
function codeFlowRelations(nodes, byId, edge) {
  const handlers = new Map();
  const exportsByName = new Map();
  const functions = new Map();
  const push = (map, key, node) => {
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(node);
  };
  for (const node of nodes) {
    if (node.group !== "code-symbol") continue;
    if (node.kind === "event" && node.role === "handler") push(handlers, node.name, node);
    else if (node.kind === "export") push(exportsByName, node.name, node);
    else if (node.kind === "function") {
      push(functions, node.name, node);
      const tail = node.name.split(/[.:]/).pop();
      if (tail !== node.name) push(functions, tail, node);
    }
  }
  for (const node of nodes) {
    if (node.group !== "code-symbol") continue;
    if (node._scope && byId.has(node._scope)) {
      edge(node._scope, node.id, node.kind === "export-call" ? "uses-export" : "emits");
    }
    if (node.kind === "event" && node.role === "emitter") {
      for (const target of (handlers.get(node.name) || []).slice(0, 16)) {
        edge(node.id, target.id, "handled-by", "extracted", target.file === node.file ? 1 : 0.95);
      }
    }
    if (node.kind === "export-call") {
      const defs = exportsByName.get(node.name) || [];
      const exact = defs.filter((d) => d.resource === node._target);
      const targets = exact.length ? exact : defs.length === 1 ? defs : [];
      for (const target of targets.slice(0, 4)) {
        edge(node.id, target.id, "calls-export", exact.length ? "extracted" : "inferred", exact.length ? 1 : 0.75);
      }
    }
    for (const call of node._calls || []) {
      let candidates = functions.get(call) || [];
      if (!candidates.length && /[.:]/.test(call)) candidates = functions.get(call.split(/[.:]/).pop()) || [];
      if (!candidates.length) continue;
      const tiers = [
        [candidates.filter((c) => c.file === node.file), "extracted", 1],
        [candidates.filter((c) => c.resource === node.resource), "inferred", 0.85],
        [candidates, "inferred", 0.75],
      ];
      for (const [tier, confidence, score] of tiers) {
        if (!tier.length) continue;
        // Unique target only: overloaded/duplicated names stay unresolved.
        if (tier.length === 1) edge(node.id, tier[0].id, "calls", confidence, score);
        break;
      }
    }
  }
}
function graphRelations(nodes) {
  const relations = [];
  const seen = new Set();
  const map = new Map();
  const resourceNodes = new Map();
  const bySymbol = new Map();
  const byPath = new Map();
  function edge(a, b, type, confidence = "extracted", score = 1) {
    if (!a || !b || a === b) return;
    const key = a + "|" + b + "|" + type;
    if (seen.has(key)) return;
    seen.add(key);
    relations.push({ source: a, target: b, type, kind: type, confidence, score });
  }
  for (const node of nodes) {
    map.set(node.id, node);
    if (node.group === "code-symbol") {
      const key = String(node.name).toLowerCase();
      if (!bySymbol.has(key)) bySymbol.set(key, []);
      bySymbol.get(key).push(node);
      if (!byPath.has(node.file)) byPath.set(node.file, []);
      byPath.get(node.file).push(node);
    }
    const resource = node.resource || "project";
    if (!resourceNodes.has(resource)) {
      resourceNodes.set(resource, {
        id: idFor("resource", resource), name: resource, group: "resource",
        kind: "resource", resource, topic: resource, source: "derived",
        content: "Índice dos símbolos e fatos deste recurso.", confidence: "extracted",
      });
    }
    edge(node.id, resourceNodes.get(resource).id, "belongs-to");
  }
  for (const node of nodes) {
    if (node.group !== "memory-atom" && node.group !== "verified-atom") continue;
    for (const name of [...(node.symbols || []), ...(node.events || [])]) {
      for (const target of (bySymbol.get(name.toLowerCase()) || []).slice(0, 12)) {
        edge(node.id, target.id, "references-symbol");
      }
    }
    for (const p of node.paths || []) {
      const normalized = asUnix(p).replace(/^\.\//, "");
      for (const target of (byPath.get(normalized) || []).slice(0, 10)) {
        edge(node.id, target.id, "references-file");
      }
    }
  }
  codeFlowRelations(nodes, map, edge);
  for (const [name, group] of bySymbol) {
    if (group.length < 2 || group.length > 16) continue;
    for (let i = 1; i < group.length; i++) edge(group[i - 1].id, group[i].id, "same-symbol");
  }
  return { nodes: [...resourceNodes.values(), ...nodes], links: relations };
}
// Learned facts are team knowledge: they live next to the Markdown memories
// (tracked by git in local mode), not in the gitignored graph/ cache.
function manualPath(root) { return path.join(resolveMemoryDir(root), "atoms.json"); }
function legacyManualPath(root) { return path.join(resolveDataRoot(root), "graph", "manual-atoms.json"); }
function loadManual(root) {
  const data = safeReadJson(manualPath(root)) || safeReadJson(legacyManualPath(root));
  return data && data.version === VERSION && Array.isArray(data.records) ? data.records : [];
}
// One record per line, sorted by id: parallel branches/agents merge cleanly in git.
function serializeManual(records) {
  const sorted = [...records].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return '{"version":' + VERSION + ',"records":[\n' + sorted.map((r) => JSON.stringify(r)).join(",\n") + "\n]}\n";
}
function addFact(root, input) {
  const topic = String(input?.topic || "").trim().slice(0, 80);
  const content = String(input?.text || "").trim();
  const relative = asUnix(String(input?.path || "").replace(/^\.\//, ""));
  const evidence = String(input?.evidence || "").trim();
  if (!topic || content.length < 12 || content.length > 900 || !relative || evidence.length < 4) {
    throw new Error("Atomic fact requires topic, text (12-900 chars), project path and exact source evidence.");
  }
  if (SECRET_LINE.test(content) || SECRET_LINE.test(evidence)) throw new Error("Sensitive fact refused.");
  const abs = path.resolve(root, relative);
  if (!abs.startsWith(path.resolve(root) + path.sep)) throw new Error("Source path escapes project.");
  const real = fs.realpathSync(abs);
  const realRoot = fs.realpathSync(root);
  if (!real.startsWith(realRoot + path.sep)) throw new Error("Source resolves outside project.");
  const stat = fs.statSync(abs);
  if (!stat.isFile() || stat.size > 1024 * 1024) throw new Error("Source is not a regular bounded file.");
  const source = fs.readFileSync(abs, "utf8");
  const evidenceOffset = source.indexOf(evidence);
  if (evidenceOffset < 0) throw new Error("Evidence does not occur in source. Recheck before learning.");
  const line = source.slice(0, evidenceOffset).split(/\r?\n/).length;
  const sourceHash = crypto.createHash("sha256").update(source).digest("hex");
  const id = idFor("fact", topic + "|" + relative + "|" + content);
  const record = {
    id, name: topic + " — " + String(input.kind || "rule").slice(0, 30),
    kind: String(input.kind || "rule").slice(0, 30),
    group: "memory-atom", topic, resource: resourceFor(relative),
    file: relative, line, sourceHash, source: "source-linked",
    confidence: "source-linked", content, evidence: cleanEvidence(evidence),
    symbols: Array.isArray(input.symbols) ? input.symbols.slice(0, 12).map(String) : [],
    events: Array.isArray(input.events) ? input.events.slice(0, 12).map(String) : [],
    sourcePaths: [relative], paths: [relative],
    learnedAt: new Date().toISOString(),
  };
  // Several agents may learn at once; serialize the read-modify-write.
  return withFileLock(root, "atomic-manual-facts", () => {
    const existing = loadManual(root);
    if (existing.some((entry) => entry.id === id && entry.sourceHash === sourceHash)) {
      return { added: false, id, topic };
    }
    const records = [...existing.filter((entry) => entry.id !== id), record]
      .sort((a, b) => String(a.learnedAt || "").localeCompare(String(b.learnedAt || "")))
      .slice(-2500);
    const dest = manualPath(root);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const tmp = dest + "." + process.pid + ".tmp";
    try {
      fs.writeFileSync(tmp, serializeManual(records), "utf8");
      fs.renameSync(tmp, dest);
    } finally { try { fs.unlinkSync(tmp); } catch {} }
    return { added: true, id, topic, file: relative, line };
  });
}

function verifiedPath(root) { return path.join(resolveDataRoot(root), "graph", "verified-atoms.json"); }
function loadVerified(root) {
  const data = safeReadJson(verifiedPath(root));
  return data && data.version === VERSION && Array.isArray(data.records) ? data.records : [];
}
/**
 * Gate V/C stores independently verified, source-exact atomic evidence.
 * It never creates broad topic files or sends source material to an LLM.
 */
function learnVerifiedSnapshot(root, session, verifiedFiles) {
  const index = readAtomic(root) || buildAtomic(root);
  const sourceSet = new Set(verifiedFiles.map(asUnix));
  const snapshot = session.gates.V.snapshot;
  const existing = loadVerified(root);
  const added = [];
  for (const node of index.nodes) {
    if (node.group !== "code-symbol" || !sourceSet.has(node.file)) continue;
    if (snapshot[node.file] !== node.sourceHash) continue;
    const id = idFor("verified", node.file + "|" + node.kind + "|" + node.name + "|" + node.sourceHash);
    if (existing.some((r) => r.id === id)) continue;
    added.push({
      id, name: node.name, kind: node.kind, group: "verified-atom",
      topic: node.topic, resource: node.resource, file: node.file, line: node.line,
      sourceHash: node.sourceHash, source: "gate-v-c", confidence: "verified",
      content: node.content, symbols: [node.name], paths: [node.file],
      verifiedAt: new Date().toISOString(),
    });
    if (added.length >= 40) break;
  }
  if (!added.length) return { status: "indexed", added: 0 };
  const dest = verifiedPath(root);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = dest + "." + process.pid + ".tmp";
  try {
    fs.writeFileSync(tmp, JSON.stringify({ version: VERSION, records: [...existing, ...added].slice(-5000) }), "utf8");
    fs.renameSync(tmp, dest);
  } finally { try { fs.unlinkSync(tmp); } catch {} }
  buildAtomic(root);
  return { status: "learned", added: added.length };
}

function buildAtomic(root, options = {}) {
  const resolved = path.resolve(root);
  const previous = options.force ? null : readAtomic(resolved);
  const files = {};
  const sources = sourceCandidates(resolved);
  const memdir = resolveMemoryDir(resolved);
  const memories = fs.existsSync(memdir)
    ? fs.readdirSync(memdir).filter((n) => n.endsWith(".md") && n !== "_index.md").map((n) => path.join(memdir, n))
    : [];
  let scanned = 0, reused = 0;
  for (const abs of [...sources, ...memories]) {
    try {
      const isMemory = memories.includes(abs);
      const key = isMemory ? "memory:" + path.basename(abs) : asUnix(path.relative(resolved, abs));
      const prior = previous?.files?.[key];
      const entry = fileEntry(resolved, abs, prior, isMemory);
      if (!entry) continue;
      files[key] = entry;
      if (entry === prior) reused++; else scanned++;
    } catch { /* tolerate files concurrently removed by IDE/build */ }
  }
  const all = Object.values(files).flatMap((item) => item.nodes || []);
  const verified = loadVerified(resolved).filter((item) => files[item.file]?.sourceHash === item.sourceHash);
  // A teammate's edit elsewhere in the file must not discard a learned fact:
  // keep it while its exact evidence still occurs in the current source.
  const manual = loadManual(resolved).flatMap((item) => {
    if (files[item.file]?.sourceHash === item.sourceHash) return [item];
    try {
      const source = path.resolve(resolved, item.file);
      if (!source.startsWith(resolved + path.sep) || fs.statSync(source).size > 1024 * 1024) return [];
      const text = fs.readFileSync(source, "utf8");
      const sourceHash = crypto.createHash("sha256").update(text).digest("hex");
      if (sourceHash === item.sourceHash) return [item];
      const offset = item.evidence && item.evidence.length >= 4 ? text.indexOf(item.evidence) : -1;
      if (offset < 0) return [];
      return [{ ...item, sourceHash, line: text.slice(0, offset).split(/\r?\n/).length, confidence: "evidence-rechecked" }];
    } catch { return []; }
  });
  const graph = graphRelations([...all, ...verified, ...manual]);
  const result = {
    version: VERSION, generatedAt: new Date().toISOString(),
    projectRoot: asUnix(resolved), scanned, reused, fileCount: Object.keys(files).length,
    truncated: sources.length >= MAX_SOURCE_FILES,
    files, nodes: graph.nodes, links: graph.links,
  };
  const dest = indexPath(resolved);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = dest + "." + process.pid + ".tmp";
  try {
    fs.writeFileSync(tmp, JSON.stringify(result), "utf8");
    fs.renameSync(tmp, dest);
  } finally { try { fs.unlinkSync(tmp); } catch {} }
  return result;
}
function fieldsForNode(node) {
  return {
    name: new Set(retrieval.termsOf(node.name || "")),
    resource: new Set(retrieval.termsOf(node.resource || "")),
    kind: new Set(retrieval.termsOf(node.kind || "")),
    content: new Set(retrieval.termsOf(node.content || "")),
    file: new Set(retrieval.termsOf(node.file || "")),
    triggers: new Set(retrieval.termsOf((node.triggers || []).join(" "))),
  };
}
function fieldsOf(node) {
  let fields = NODE_FIELDS.get(node);
  if (!fields) {
    fields = fieldsForNode(node);
    NODE_FIELDS.set(node, fields);
  }
  return fields;
}
function scoreNode(node, concepts, fields = fieldsForNode(node)) {
  let score = 0, matched = 0;
  for (const concept of concepts) {
    let weight = 0;
    for (const [field, boost] of [["name", 7], ["triggers", 5], ["content", 2.2], ["kind", 1], ["resource", 1.4], ["file", 0.6]]) {
      if (concept.variants.some((variant) => fields[field].has(variant))) weight = Math.max(weight, boost);
    }
    if (weight) { score += weight; matched++; }
  }
  if (!matched) return 0;
  // A topic name alone must not outweigh a specific requested behavior.
  const coverage = matched / Math.max(1, concepts.length);
  return score * (0.2 + 0.8 * coverage) + (coverage === 1 ? 1 : 0)
    + (node.group === "verified-atom" ? 1.2 : 0);
}
const RECENT_CHECKS = new Map();
const FULL_SCAN_CHECKS = new Map();
function indexHasChanged(root, index) {
  for (const [key, entry] of Object.entries(index.files || {})) {
    const abs = key.startsWith("memory:")
      ? path.join(resolveMemoryDir(root), key.slice(7))
      : path.resolve(root, key);
    try {
      const stat = fs.statSync(abs);
      if (stat.mtimeMs !== entry.mtimeMs || stat.size !== entry.size) return true;
    } catch { return true; }
  }
  const now = Date.now();
  const lastScan = FULL_SCAN_CHECKS.get(path.resolve(root)) || Date.parse(index.generatedAt) || 0;
  if (now - lastScan > 180000) {
    FULL_SCAN_CHECKS.set(path.resolve(root), now);
    const known = new Set(Object.keys(index.files || {}).filter((key) => !key.startsWith("memory:")));
    const actual = sourceCandidates(root).map((file) => asUnix(path.relative(root, file)));
    if (actual.length !== known.size || actual.some((file) => !known.has(file))) return true;
    const memdir = resolveMemoryDir(root);
    const actualMemory = fs.existsSync(memdir)
      ? fs.readdirSync(memdir).filter((name) => name.endsWith(".md") && name !== "_index.md") : [];
    const knownMemory = Object.keys(index.files || {}).filter((key) => key.startsWith("memory:"));
    if (actualMemory.length !== knownMemory.length) return true;
  }
  return false;
}

function queryAtomic(root, question, options = {}) {
  let index = readQueryIndex(root);
  if (!index) return null;
  const key = path.resolve(root);
  if (options.refresh !== false && Date.now() - (RECENT_CHECKS.get(key) || 0) > 30000) {
    RECENT_CHECKS.set(key, Date.now());
    if (indexHasChanged(key, index)) {
      try { index = buildAtomic(key); } catch { /* retain last good index on transient I/O */ }
    }
  }
  const concepts = retrieval.questionConcepts(question);
  if (!concepts.length) return { index, hits: [], related: [], tokensUsed: 0 };
  const budget = Math.max(1, Math.min(8000, Number(options.budget) || 1500));
  // Broad "what is inside garages?" requests deserve a compact inventory,
  // not arbitrary top-3 symbol snippets or the whole garages.md.
  const asksOverview = /\b(dentro|quais|listar|liste|possui|cont[eé]m|tinha|overview)\b/i.test(question);
  if (asksOverview && budget >= 60) {
    const resource = (index.nodes || []).find((node) =>
      node.group === "resource" && concepts.some((concept) =>
        concept.variants.some((term) => retrieval.termsOf(node.name).includes(term))));
    if (resource) {
      const children = (index.nodes || []).filter((node) =>
        node.group === "code-symbol" && node.resource === resource.name);
      const sections = [];
      for (const kind of ["function", "event", "export", "command", "sql-table"]) {
        const found = [...new Set(children.filter((node) => node.kind === kind).map((node) => node.name))];
        if (found.length) sections.push(kind + " (" + found.length + "): " + found.slice(0, 24).join(", "));
      }
      const factCount = (index.nodes || []).filter((node) =>
        node.group === "memory-atom" && node.resource === resource.name).length;
      sections.push("Fatos documentados: " + factCount);
      if (index.truncated) sections.push("Índice parcial: confirme itens ausentes no código.");
      const content = sections.join("\n").slice(0, Math.max(100, budget * 4 - 160));
      const node = {
        id: idFor("overview", resource.name), name: resource.name + " — resumo",
        group: "resource", kind: "resource-overview", resource: resource.name,
        file: ".fxmind/graph/atomic-index.json", content, source: "indexed-source",
      };
      return { index, hits: [{ node, score: 100, tokens: retrieval.estimateTokens(content) + 25 }],
        related: children.slice(0, 12).map((entry) => ({
          id: entry.id, name: entry.name, kind: entry.kind, type: "belongs-to",
        })), tokensUsed: retrieval.estimateTokens(content) + 25 };
    }
  }
  const ranked = (index.nodes || [])
    .filter((node) => ["code-symbol", "memory-atom", "verified-atom"].includes(node.group))
    .map((node) => {
      let fields = NODE_FIELDS.get(node);
      if (!fields) {
        fields = fieldsForNode(node);
        NODE_FIELDS.set(node, fields);
      }
      return { node, score: scoreNode(node, concepts, fields) };
    })
    .filter((hit) => hit.score >= (concepts.length > 1 ? 1.5 : 0.5))
    .sort((a, b) => b.score - a.score || a.node.id.localeCompare(b.node.id));
  const hits = [], selected = new Set(), memorySlugs = new Set();
  let tokensUsed = 0;
  for (const hit of ranked) {
    if (hits.length >= (options.limit || 3)) break;
    if (ranked[0] && hit.score < ranked[0].score * 0.38) break;
    const cost = retrieval.estimateTokens(hit.node.content) + 35;
    if (tokensUsed + cost > budget) continue;
    // Prefer distinct evidence when the same symbol occurs more than once.
    const dedupe = hit.node.file + ":" + hit.node.name + ":" + hit.node.content;
    if (selected.has(dedupe)) continue;
    if (hit.node.group === "memory-atom" && hit.node.slug && memorySlugs.has(hit.node.slug)) continue;
    selected.add(dedupe);
    if (hit.node.group === "memory-atom" && hit.node.slug) memorySlugs.add(hit.node.slug);
    tokensUsed += cost;
    hits.push({ ...hit, tokens: cost });
  }
  const ids = new Set(hits.map((hit) => hit.node.id));
  // Per-term guarantee (graphify #1445): a query term matched by no hit may
  // add its best node as a seed, so one dominant term cannot starve the rest.
  const covers = (node, concept) => {
    const fields = fieldsOf(node);
    return concept.variants.some((v) => fields.name.has(v) || fields.content.has(v) || fields.triggers.has(v));
  };
  if (concepts.length > 1 && hits.length) {
    for (const concept of concepts) {
      if (hits.length >= (options.limit || 3) + 2) break;
      if (hits.some((hit) => covers(hit.node, concept))) continue;
      const best = ranked.find((hit) => !ids.has(hit.node.id) && covers(hit.node, concept)
        && hit.score >= ranked[0].score * 0.15);
      if (!best) continue;
      const cost = retrieval.estimateTokens(best.node.content) + 35;
      if (tokensUsed + cost > budget) continue;
      ids.add(best.node.id);
      tokensUsed += cost;
      hits.push({ ...best, tokens: cost, via: "term:" + concept.term });
    }
  }
  const graph = graphView(index);
  const related = expandFromSeeds(graph, [...ids], concepts, { limit: 12 });
  // Leftover budget pulls in direct code-flow neighbours (handler of an
  // emitted event, called function, export definition) as evidence.
  if (options.expand !== false) {
    for (const rel of related) {
      if (hits.length >= (options.limit || 3) + 2) break;
      if (rel.hop !== 1 || !FLOW_TYPES.has(rel.type)) continue;
      const node = graph.byId.get(rel.id);
      if (!node || node.group !== "code-symbol") continue;
      const cost = retrieval.estimateTokens(node.content) + 35;
      if (tokensUsed + cost > budget * 0.9) continue;
      tokensUsed += cost;
      ids.add(node.id);
      hits.push({ node, score: Math.round(rel.score * 100) / 100, tokens: cost, via: rel.type });
    }
  }
  return { index, hits, related: related.filter((rel) => !ids.has(rel.id)), tokensUsed };
}
const EDGE_WEIGHTS = {
  "handled-by": 1, calls: 1, "calls-export": 1, "uses-export": 0.9, emits: 0.9,
  "references-symbol": 0.9, "references-file": 0.6, "same-symbol": 0.5, "belongs-to": 0.25,
};
const FLOW_TYPES = new Set(["handled-by", "calls", "calls-export", "uses-export", "emits"]);
const GRAPH_VIEWS = new WeakMap();
/** Undirected adjacency + hub threshold, cached per loaded index. */
function graphView(index) {
  let view = GRAPH_VIEWS.get(index);
  if (view) return view;
  const byId = new Map((index.nodes || []).map((node) => [node.id, node]));
  const adj = new Map();
  for (const link of index.links || []) {
    if (!byId.has(link.source) || !byId.has(link.target)) continue;
    const w = (EDGE_WEIGHTS[link.type] ?? 0.4) * (Number(link.score) || 1);
    for (const [a, b, dir] of [[link.source, link.target, "out"], [link.target, link.source, "in"]]) {
      if (!adj.has(a)) adj.set(a, []);
      adj.get(a).push({ id: b, type: link.type, w, dir });
    }
  }
  const degrees = [...adj.values()].map((list) => list.length).sort((x, y) => x - y);
  const hub = Math.max(30, degrees[Math.floor(degrees.length * 0.99)] || 0);
  view = { byId, adj, hub };
  GRAPH_VIEWS.set(index, view);
  return view;
}
/**
 * Two-hop weighted expansion from the seeds. Hubs (resource nodes, degree at
 * or above the p99 floor) are reported but never used as transit, so one
 * shared resource cannot drag every symbol into the answer. Ranking: path
 * weight decayed per hop, plus a bonus when the node itself matches the query.
 */
function expandFromSeeds(graph, seeds, concepts, options = {}) {
  const seedSet = new Set(seeds);
  const best = new Map();
  let frontier = seeds.map((id) => ({ id, w: 1 }));
  for (let hop = 1; hop <= (options.depth || 2) && frontier.length; hop++) {
    const next = [];
    for (const { id, w } of frontier) {
      const node = graph.byId.get(id);
      const neighbours = graph.adj.get(id) || [];
      const transit = seedSet.has(id) || (node?.group !== "resource" && neighbours.length < graph.hub);
      if (!transit) continue;
      for (const edge of neighbours) {
        if (seedSet.has(edge.id)) continue;
        const weight = w * edge.w / hop;
        const prior = best.get(edge.id);
        if (prior && prior.weight >= weight) continue;
        best.set(edge.id, { id: edge.id, hop: prior ? Math.min(prior.hop, hop) : hop, weight,
          type: edge.type, direction: edge.dir });
        next.push({ id: edge.id, w: weight });
      }
    }
    frontier = next;
  }
  const scored = [...best.values()].map((entry) => {
    const node = graph.byId.get(entry.id);
    const match = concepts.length ? scoreNode(node, concepts, fieldsOf(node)) : 0;
    return { ...entry, node, score: entry.weight * 2 + Math.min(match, 10) * 0.15 };
  });
  scored.sort((a, b) => b.score - a.score || a.hop - b.hop || a.id.localeCompare(b.id));
  return scored.slice(0, options.limit || 12).map(({ node, id, hop, type, direction, score }) => ({
    id, name: node.name, kind: node.kind, type, hop, direction,
    score: Math.round(score * 100) / 100,
    ...(node.file ? { file: node.file, line: node.line } : {}),
  }));
}
module.exports = { VERSION, expandFromSeeds, graphView, indexPath, readAtomic, buildAtomic, queryAtomic, resourceFor, sourceNodes, memoryNodes, scoreNode, learnVerifiedSnapshot, addFact };
