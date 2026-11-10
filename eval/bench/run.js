#!/usr/bin/env node
"use strict";
/**
 * fxmind retrieval benchmark (mechanism only, no LLM involved).
 *
 *   node eval/bench/run.js <project-root> [--n 150] [--seed 7] [--out result.json] [--compare baseline.cjs]
 *
 * The project is never modified: source files are copied into a scratch folder.
 * Questions: pick symbols/events defined in exactly one file, ask for them the way a
 * person would ("garages store"), and check whether the defining file comes back.
 * Baseline: grep the most distinctive word, read every matching file in full.
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { performance } = require("node:perf_hooks");
const { createHash } = require("node:crypto");

const args = process.argv.slice(2);
const root = path.resolve(args[0] || "");
const opt = (name, def) => { const i = args.indexOf("--" + name); return i >= 0 ? args[i + 1] : def; };
const N = Number(opt("n", 150)), SEED = Number(opt("seed", 7)), OUT = opt("out", "");
if (!fs.existsSync(root)) { console.error("usage: run.js <project-root>"); process.exit(1); }

const atomic = require("../../scripts/lib/atomic-memory");
const compare = opt("compare", "");
const baseline = compare ? require(path.resolve(compare)) : null;
const retrieval = require("../../scripts/lib/memory-retrieval");
const EXT = new Set([".lua", ".js", ".jsx", ".ts", ".tsx", ".sql", ".py"]);
const SKIP = new Set([".git", ".fxmind", "node_modules", "dist", "build", "vendor", "cache", "stream", "html", ".next", "coverage", "__pycache__"]);
const MAX_BYTES = 350 * 1024;

// 1) copy sources to scratch (read-only on the project)
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "fxbench-"));
let copied = 0, bytes = 0;
(function walk(dir) {
  let entries; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP.has(e.name)) walk(p); continue; }
    if (!e.isFile() || !EXT.has(path.extname(e.name).toLowerCase())) continue;
    let st; try { st = fs.statSync(p); } catch { continue; }
    if (st.size > MAX_BYTES) continue;
    const dest = path.join(scratch, path.relative(root, p));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(p, dest); copied++; bytes += st.size;
  }
})(root);

// 2) index (cold) and incremental refresh
let t = performance.now();
const index = atomic.buildAtomic(scratch);
const coldMs = performance.now() - t;
const touched = path.join(scratch, [...new Set(index.nodes.filter((n) => n.group === "code-symbol").map((n) => n.file))][0]);
fs.appendFileSync(touched, "\n-- bench edit\n");
t = performance.now();
atomic.buildAtomic(scratch);
const incrMs = performance.now() - t;

// 3) questions with unambiguous ground truth
const defs = new Map();
for (const n of index.nodes) {
  if (n.group !== "code-symbol" || !["event", "function"].includes(n.kind) || n.name.length < 6) continue;
  const f = defs.get(n.name) || new Set(); f.add(n.file); defs.set(n.name, f);
}
let s = SEED; const rnd = () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
const pool = [...defs].filter(([, f]) => f.size === 1).map(([name, f]) => ({ name, file: [...f][0] }));
for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
const questions = pool.slice(0, N).map((q) => ({
  ...q, text: q.name.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[:._\-]+/g, " ").toLowerCase(),
}));

// 4) baseline corpus
const files = [...new Set(index.nodes.map((n) => n.file).filter((f) => f && !f.startsWith(".fxmind")))]
  .filter((f) => fs.existsSync(path.join(scratch, f)));
const corpus = files.map((f) => ({ f, body: fs.readFileSync(path.join(scratch, f), "utf8") }));

const med = (a) => { const b = [...a].sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : 0; };
const pct = (a, p) => { const b = [...a].sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(b.length * p))] || 0; };
const { spawnSync } = require("node:child_process");
const r = { exact: { tokens: [] }, fx: { tokens: [], ms: [], top1: 0, top3: 0, any: 0 }, grep: { tokens: [], ms: [], found: 0, files: [] } };
const responses = createHash("sha256");
const baselineResponses = createHash("sha256");
const baselineStats = { ms: [], tokens: [], top1: 0, top3: 0 };
const corpusHash = createHash("sha256");
for (const { f, body } of corpus) corpusHash.update(JSON.stringify([f, body]));

for (const q of questions) {
  // fxmind
  t = performance.now();
  const res = atomic.queryAtomic(scratch, q.text, { budget: 1500, refresh: false });
  r.fx.ms.push(performance.now() - t);
  const hits = (res && res.hits) || [];
  responses.update(JSON.stringify({ question: q.text, hits, related: res?.related, tokensUsed: res?.tokensUsed }));
  r.fx.tokens.push(hits.reduce((n, h) => n + (h.tokens || retrieval.estimateTokens(h.node.content || "")), 0));
  const rank = hits.findIndex((h) => h.node.file === q.file);
  if (rank === 0) r.fx.top1++; if (rank >= 0 && rank < 3) r.fx.top3++; if (rank >= 0) r.fx.any++;
  if (baseline) {
    t = performance.now();
    const before = baseline.queryAtomic(scratch, q.text, { budget: 1500, refresh: false });
    baselineStats.ms.push(performance.now() - t);
    baselineStats.tokens.push(before.tokensUsed);
    baselineResponses.update(JSON.stringify({ question: q.text, hits: before.hits, related: before.related, tokensUsed: before.tokensUsed }));
    const position = before.hits.findIndex((hit) => hit.node.file === q.file);
    if (position === 0) baselineStats.top1++;
    if (position >= 0 && position < 3) baselineStats.top3++;
  }
  // grep baseline: the rarest word of the query, whole matching files
  const words = q.text.split(" ").filter((w) => w.length > 2);
  const word = words.sort((a, b) => b.length - a.length)[0] || q.text;
  const re = new RegExp(word.replace(/[^a-z0-9_]/gi, ""), "i");
  const matched = corpus.filter((c) => re.test(c.body));
  t = performance.now();
  const grep = spawnSync("rg", ["-l", "-i", "--no-messages", word.replace(/[^a-z0-9_]/gi, ""), scratch], { encoding: "utf8", maxBuffer: 1 << 26 });
  r.grep.ms.push(performance.now() - t);
  if (grep.error || ![0, 1].includes(grep.status)) throw grep.error || new Error(grep.stderr || "ripgrep failed");
  const truth = corpus.find((c) => c.f === q.file);
  r.exact.tokens.push(truth ? Math.ceil(truth.body.length / 4) : 0);
  r.grep.tokens.push(matched.reduce((n, c) => n + Math.ceil(c.body.length / 4), 0));
  r.grep.files.push(matched.length);
  if (matched.some((c) => c.f === q.file)) r.grep.found++;
}

const out = {
  project: path.basename(root), indexedFiles: copied, sourceMB: +(bytes / 1048576).toFixed(1), nodes: index.nodes.length,
  questions: questions.length,
  seed: SEED, corpusHash: corpusHash.digest("hex"), responseHash: responses.digest("hex"),
  indexing: { coldMs: Math.round(coldMs), incrementalMs: Math.round(incrMs) },
  fxmind: {
    tokensMedian: med(r.fx.tokens), tokensP90: pct(r.fx.tokens, 0.9),
    msMedian: +med(r.fx.ms).toFixed(2), msP90: +pct(r.fx.ms, 0.9).toFixed(2),
    firstQueryMs: +r.fx.ms[0].toFixed(2), warmMsMedian: +med(r.fx.ms.slice(1)).toFixed(2),
    top1: +(r.fx.top1 / questions.length).toFixed(3), top3: +(r.fx.top3 / questions.length).toFixed(3), anyHit: +(r.fx.any / questions.length).toFixed(3),
  },
  exactNameBaseline: { note: "agent already knows the exact identifier: reads only the defining file", tokensMedian: med(r.exact.tokens), tokensP90: pct(r.exact.tokens, 0.9) },
  grepBaseline: {
    tokensMedian: med(r.grep.tokens), tokensP90: pct(r.grep.tokens, 0.9),
    msMedian: +med(r.grep.ms).toFixed(2), timedWith: "ripgrep on disk", filesToReadMedian: med(r.grep.files),
    contains: +(r.grep.found / questions.length).toFixed(3),
    precisionMedian: +med(r.grep.files.map((n) => (n ? 1 / n : 0))).toFixed(4),
  },
  note: "Mechanism benchmark: no agent or LLM. Tokens estimated as chars/4. Ground truth = file defining a symbol/event unique to one file.",
};
if (baseline) {
  const responseHash = baselineResponses.digest("hex");
  out.comparison = {
    sameResponses: responseHash === out.responseHash, responseHash,
    msMedian: +med(baselineStats.ms).toFixed(2), msP90: +pct(baselineStats.ms, 0.9).toFixed(2),
    firstQueryMs: +baselineStats.ms[0].toFixed(2), warmMsMedian: +med(baselineStats.ms.slice(1)).toFixed(2),
    tokensMedian: med(baselineStats.tokens),
    top1: +(baselineStats.top1 / questions.length).toFixed(3), top3: +(baselineStats.top3 / questions.length).toFixed(3),
  };
}
fs.rmSync(scratch, { recursive: true, force: true });
if (OUT) fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");
console.log(JSON.stringify(out, null, 2));
if (out.comparison && !out.comparison.sameResponses) process.exitCode = 1;
