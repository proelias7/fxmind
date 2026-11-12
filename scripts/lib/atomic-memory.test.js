"use strict";
const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const atomic = require("./atomic-memory");
const tools = require("../fxmind-tools");

let root;
const source = "resources/[ecco]/garages/server.lua";
const memory = ".fxmind/memory/garages.md";
const body = [
  'RegisterNetEvent("garages:store")',
  "local function canStoreVehicle(userId, plate)",
  "  if not userId or not plate then return false end",
  "  return true",
  "end",
  'RegisterNetEvent("garages:retrieve")',
  "function retrieveVehicle(plate)",
  "  return plate",
  "end",
  "",
].join("\n");
const note = [
  "---",
  "topic: garages",
  "updated: 2026-10-26",
  "lang: en-compact",
  "paths: [resources/[ecco]/garages/server.lua]",
  "symbols: [canStoreVehicle, retrieveVehicle]",
  "triggers: [garages, guardar veiculo, retirar veiculo]",
  "---",
  "# garages",
  "## Guardar veículo",
  "Guardar veículo valida placa e proprietário pelo evento garages:store.",
  "",
  "## Retirar veículo",
  "Retirar veículo usa o evento garages:retrieve e a função retrieveVehicle.",
  "",
  "## Multas",
  "A multa de apreensão deve ser verificada antes de liberar.",
  "",
].join("\n");

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "fxatomic-"));
  fs.mkdirSync(path.dirname(path.join(root, source)), { recursive: true });
  fs.mkdirSync(path.join(root, ".fxmind", "memory"), { recursive: true });
  fs.writeFileSync(path.join(root, source), body);
  fs.writeFileSync(path.join(root, memory), note);
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("atomic query cache", () => {
  it("reuses the index and prepared terms without changing scores or answers", (t) => {
    atomic.buildAtomic(root);
    const indexFile = atomic.indexPath(root);
    const read = fs.readFileSync;
    const retrieval = require("./memory-retrieval");
    const terms = retrieval.termsOf;
    let reads = 0, tokenizations = 0;
    t.mock.method(fs, "readFileSync", (file, ...args) => {
      if (file === indexFile) reads++;
      return read(file, ...args);
    });
    t.mock.method(retrieval, "termsOf", (...args) => { tokenizations++; return terms(...args); });
    const options = { refresh: false, budget: 450 };
    const first = atomic.queryAtomic(root, "guardar veiculo garagem", options);
    const prepared = tokenizations;
    assert.ok(prepared > 0);
    const second = atomic.queryAtomic(root, "guardar veiculo garagem", options);
    assert.equal(reads, 1);
    assert.equal(tokenizations, prepared);
    assert.equal(second.index, first.index);
    assert.deepEqual(second, first);
    const concepts = retrieval.questionConcepts("guardar veiculo garagem");
    for (const hit of second.hits) assert.equal(hit.score, atomic.scoreNode(hit.node, concepts));
  });

  it("reloads an index rebuilt by another process, including its search terms", () => {
    atomic.buildAtomic(root);
    const first = atomic.queryAtomic(root, "canStoreVehicle", { refresh: false });
    assert.ok(first.hits.some((h) => h.node.name === "canStoreVehicle"));
    fs.writeFileSync(path.join(root, source), body.replace("canStoreVehicle", "canPlaceVehicle"));
    require("node:child_process").execFileSync(process.execPath, [
      "-e", "require(process.argv[1]).buildAtomic(process.argv[2])", require.resolve("./atomic-memory"), root,
    ], { timeout: 30000 });
    const second = atomic.queryAtomic(root, "canPlaceVehicle", { refresh: false });
    assert.notEqual(second.index, first.index);
    assert.ok(second.hits.some((h) => h.node.name === "canPlaceVehicle"));
    assert.ok(!second.hits.some((h) => h.node.name === "canStoreVehicle"));
  });

  it("still checks source freshness when the query index is already cached", () => {
    atomic.buildAtomic(root);
    atomic.queryAtomic(root, "canStoreVehicle", { refresh: false });
    fs.writeFileSync(path.join(root, source), body.replace("canStoreVehicle", "canPlaceVehicle"));
    const result = atomic.queryAtomic(root, "canPlaceVehicle");
    assert.ok(result.hits.some((h) => h.node.name === "canPlaceVehicle"));
    assert.ok(!result.index.nodes.some((n) => n.name === "canStoreVehicle"));
  });

  it("resolves storage changes instead of reusing a previous project's data path", () => {
    const index = atomic.buildAtomic(root);
    const first = atomic.queryAtomic(root, "garages store", { refresh: false });
    const globalRoot = path.join(root, "global-store");
    fs.mkdirSync(path.join(globalRoot, "graph"), { recursive: true });
    fs.writeFileSync(path.join(globalRoot, "graph", "atomic-index.json"), JSON.stringify({ ...index, nodes: [], links: [] }));
    const storeFile = path.join(root, ".fxmind", "store.json");
    fs.writeFileSync(storeFile, JSON.stringify({ mode: "global", globalRoot }));
    assert.equal(atomic.queryAtomic(root, "garages store", { refresh: false }).hits.length, 0);
    fs.unlinkSync(storeFile);
    assert.deepEqual(atomic.queryAtomic(root, "garages store", { refresh: false }).hits, first.hits);
  });

  it("does not return cached facts after deletion, corruption or an incompatible version", () => {
    atomic.buildAtomic(root);
    const file = atomic.indexPath(root);
    const saved = fs.readFileSync(file, "utf8");
    const query = () => atomic.queryAtomic(root, "garages store", { refresh: false });
    assert.ok(query().hits.length);
    fs.unlinkSync(file);
    assert.equal(query(), null);
    fs.writeFileSync(file, saved);
    assert.ok(query().hits.length);
    fs.writeFileSync(file, "{");
    assert.equal(query(), null);
    fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(saved), version: -1 }));
    assert.equal(query(), null);
    fs.writeFileSync(file, saved);
    assert.ok(query().hits.length);
  });

  it("keeps project caches separate and evicts the least recently used index", (t) => {
    const projects = [root, path.join(root, "second"), path.join(root, "third")];
    for (const project of projects) {
      fs.mkdirSync(path.join(project, "src"), { recursive: true });
      fs.writeFileSync(path.join(project, "src", "test.js"), "function benchmarkHelper() { return true; }");
      atomic.buildAtomic(project);
    }
    const read = fs.readFileSync;
    const reads = new Map();
    const indexes = new Set(projects.map(atomic.indexPath));
    t.mock.method(fs, "readFileSync", (file, ...args) => {
      if (indexes.has(file)) reads.set(file, (reads.get(file) || 0) + 1);
      return read(file, ...args);
    });
    const query = (project) => atomic.queryAtomic(project, "benchmarkHelper", { refresh: false });
    const first = query(root);
    const second = query(projects[1]);
    assert.notEqual(second.index.projectRoot, first.index.projectRoot);
    query(root);
    query(projects[2]);
    assert.equal(query(root).index, first.index);
    assert.notEqual(query(projects[1]).index, second.index);
    assert.equal(reads.get(atomic.indexPath(root)), 1);
    assert.equal(reads.get(atomic.indexPath(projects[1])), 2);
  });
});

describe("atomic graph and memory", () => {
  it("indexes code, events, and one memory fact per section without modifying notes", () => {
    const before = fs.readFileSync(path.join(root, memory), "utf8");
    const graph = atomic.buildAtomic(root);
    assert.ok(graph.nodes.some((n) => n.kind === "function" && n.name === "canStoreVehicle"));
    assert.ok(graph.nodes.some((n) => n.kind === "event" && n.name === "garages:store"));
    assert.ok(graph.nodes.some((n) => n.group === "memory-atom" && n.content.includes("placa")));
    assert.ok(graph.links.some((edge) => edge.type === "belongs-to"));
    assert.ok(graph.links.some((edge) => edge.type === "references-symbol"));
    assert.equal(fs.readFileSync(path.join(root, memory), "utf8"), before);
  });

  it("returns only relevant fragments, not the whole garage.md", () => {
    atomic.buildAtomic(root);
    const answer = atomic.queryAtomic(root, "guardar veiculo garagem", { budget: 450 });
    assert.ok(answer.hits.length > 0);
    assert.ok(answer.hits.some((h) => h.node.content.includes("placa")));
    assert.ok(answer.hits.every((h) => !h.node.content.includes("multa de apreensão")));
    assert.ok(answer.tokensUsed <= 450);
    const result = tools.queryGraph(root, "guardar veiculo garagem", { rebuild: false, budget: 450 });
    assert.equal(result.mode, "atomic");
    assert.ok(result.memories.some((m) => m.content.includes("placa")));
    assert.ok(result.memories.every((m) => !m.content.includes("multa de apreensão")));
  });

  it("answers broad questions with a compact resource inventory", () => {
    atomic.buildAtomic(root);
    const answer = tools.queryGraph(root, "o que tinha dentro da garages?", { rebuild: false, budget: 350 });
    assert.equal(answer.mode, "atomic");
    assert.equal(answer.memories.length, 1);
    assert.equal(answer.memories[0].kind, "resource-overview");
    assert.match(answer.memories[0].content, /canStoreVehicle/);
    assert.match(answer.memories[0].content, /garages:store/);
    assert.ok(answer.tokensUsed <= 350);
  });

  it("incrementally updates only changed sources and removes stale nodes", () => {
    const first = atomic.buildAtomic(root);
    const second = atomic.buildAtomic(root);
    assert.equal(second.scanned, 0);
    assert.equal(second.reused, first.fileCount);
    fs.writeFileSync(path.join(root, source), body.replace("canStoreVehicle", "canParkVehicle"));
    const third = atomic.buildAtomic(root);
    assert.equal(third.scanned, 1);
    assert.ok(third.nodes.some((node) => node.name === "canParkVehicle"));
    assert.ok(!third.nodes.some((node) => node.name === "canStoreVehicle"));
    fs.unlinkSync(path.join(root, source));
    const fourth = atomic.buildAtomic(root);
    assert.ok(!fourth.nodes.some((node) => node.name === "canParkVehicle"));
    assert.ok(fs.existsSync(path.join(root, memory)));
  });

  it("respects global storage and keeps the repo note accessible", () => {
    const globalRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fxglobal-"));
    try {
      const memdir = path.join(globalRoot, "memory");
      fs.mkdirSync(memdir, { recursive: true });
      fs.copyFileSync(path.join(root, memory), path.join(memdir, "garages.md"));
      fs.writeFileSync(path.join(root, ".fxmind", "store.json"), JSON.stringify({
        mode: "global", globalRoot, projectId: "example",
      }));
      const indexed = atomic.buildAtomic(root);
      assert.ok(indexed.nodes.some((n) => n.group === "memory-atom"));
      assert.ok(fs.existsSync(path.join(globalRoot, "graph", "atomic-index.json")));
      assert.equal(fs.existsSync(path.join(root, ".fxmind", "graph", "atomic-index.json")), false);
    } finally {
      fs.rmSync(globalRoot, { recursive: true, force: true });
    }
  });

  it("does not index obvious secret assignment values", () => {
    const nodes = atomic.sourceNodes(root, source, 'function protected()\n  api_key = "secret-value"\nend', "hash");
    assert.ok(nodes.every((node) => !node.content.includes("secret-value")));
  });

  it("detects newly added code files without reading unrelated topic Markdown", () => {
    atomic.buildAtomic(root);
    const pathToIndex = atomic.indexPath(root);
    const state = JSON.parse(fs.readFileSync(pathToIndex, "utf8"));
    state.generatedAt = "2020-01-01T00:00:00.000Z";
    fs.writeFileSync(pathToIndex, JSON.stringify(state));
    const more = "resources/[ecco]/garages/extra.lua";
    fs.writeFileSync(path.join(root, more), 'RegisterNetEvent("garages:impound")');
    const got = atomic.queryAtomic(root, "garages:impound");
    assert.ok(got.hits.some((hit) => hit.node.name === "garages:impound"));
  });

  it("CLI migration rebuilds the index and retains Markdown", () => {
    const { execFileSync } = require("node:child_process");
    const previous = fs.readFileSync(path.join(root, memory), "utf8");
    const command = path.resolve(__dirname, "..", "install.js");
    const result = JSON.parse(execFileSync(process.execPath, [
      command, "memory", "migrate", "--target", root,
    ], { encoding: "utf8", timeout: 30000 }));
    assert.equal(result.ok, true);
    assert.equal(result.legacyMemoriesPreserved, true);
    assert.equal(fs.readFileSync(path.join(root, memory), "utf8"), previous);
    assert.ok(fs.existsSync(atomic.indexPath(root)));
  });
});

describe("source-grounded manual learning", () => {
  const input = () => ({
    topic: "garages", kind: "behavior",
    text: "Before a vehicle is stored, the handler rejects a missing plate or user id.",
    path: source,
    evidence: "if not userId or not plate then return false end",
    symbols: ["canStoreVehicle"],
    events: ["garages:store"],
  });

  it("stores one linked microfact, deduplicates it, and preserves legacy notes", () => {
    const before = fs.readFileSync(path.join(root, memory), "utf8");
    const first = atomic.addFact(root, input());
    assert.equal(first.added, true);
    assert.equal(atomic.addFact(root, input()).added, false);
    const graph = atomic.buildAtomic(root);
    const atoms = graph.nodes.filter((node) => node.id === first.id);
    assert.equal(atoms.length, 1);
    assert.equal(atoms[0].line, 3);
    assert.ok(graph.links.some((edge) => edge.type === "references-symbol"));
    assert.equal(fs.readFileSync(path.join(root, memory), "utf8"), before);
  });

  it("refuses unsupported claims, source path escape, and secret evidence", () => {
    assert.throws(() => atomic.addFact(root, { ...input(), evidence: "made-up source" }), /Evidence does not occur/);
    assert.throws(() => atomic.addFact(root, { ...input(), path: "../outside.lua" }), /escapes project/);
    assert.throws(() => atomic.addFact(root, { ...input(), text: 'api_key = "super-secret"' }), /Sensitive fact/);
  });

  it("keeps a fact across unrelated edits and drops it once its evidence is gone", () => {
    const fact = atomic.addFact(root, input());
    assert.ok(atomic.buildAtomic(root).nodes.some((node) => node.id === fact.id));
    fs.writeFileSync(path.join(root, source), "-- teammate header\n" + body);
    const kept = atomic.buildAtomic(root).nodes.find((node) => node.id === fact.id);
    assert.equal(kept.line, 4);
    assert.equal(kept.confidence, "evidence-rechecked");
    fs.writeFileSync(path.join(root, source), body.replace(input().evidence, "if not plate then return false end"));
    assert.ok(!atomic.buildAtomic(root).nodes.some((node) => node.id === fact.id));
  });

  it("stores learned facts in the shared, git-tracked memory folder", () => {
    atomic.addFact(root, input());
    atomic.addFact(root, { ...input(), text: "Retrieving a vehicle goes through the retrieveVehicle function.", evidence: "function retrieveVehicle(plate)" });
    const file = path.join(root, ".fxmind", "memory", "atoms.json");
    const text = fs.readFileSync(file, "utf8");
    assert.equal(JSON.parse(text).records.length, 2);
    // One record per line so parallel branches merge line by line.
    assert.equal(text.trim().split("\n").length, 4);
    assert.equal(fs.existsSync(path.join(root, ".fxmind", "graph", "manual-atoms.json")), false);
    assert.ok(!require("../lib/layout").PROJECT_GITIGNORE_LINES.some((line) => ".fxmind/memory/atoms.json".startsWith(line)));
  });

  it("reads legacy graph/manual-atoms.json and migrates it on the next write", () => {
    const legacy = path.join(root, ".fxmind", "graph", "manual-atoms.json");
    atomic.addFact(root, input());
    const moved = path.join(root, ".fxmind", "memory", "atoms.json");
    fs.mkdirSync(path.dirname(legacy), { recursive: true });
    fs.renameSync(moved, legacy);
    const [old] = JSON.parse(fs.readFileSync(legacy, "utf8")).records;
    assert.ok(atomic.buildAtomic(root).nodes.some((node) => node.id === old.id));
    atomic.addFact(root, { ...input(), text: "Retrieving a vehicle goes through the retrieveVehicle function.", evidence: "function retrieveVehicle(plate)" });
    const ids = JSON.parse(fs.readFileSync(moved, "utf8")).records.map((r) => r.id);
    assert.ok(ids.includes(old.id));
    assert.equal(ids.length, 2);
  });

  it("CLI learns without new MCP tool and returns a linked fact", () => {
    const { execFileSync } = require("node:child_process");
    const result = JSON.parse(execFileSync(process.execPath, [
      path.resolve(__dirname, "..", "install.js"), "memory", "add",
      "--target", root, "--topic", "garages",
      "--text", input().text, "--path", source,
      "--evidence", input().evidence,
    ], { encoding: "utf8", timeout: 30000 }));
    assert.equal(result.ok, true);
    assert.equal(result.fact.added, true);
    assert.ok(atomic.readAtomic(root).nodes.some((n) => n.id === result.fact.id));
  });
});

describe("atomic code flow", () => {
  const files = {
    "resources/[g]/garages/client.lua": [
      "local function openMenu()",
      "  local ok = exports['bank']:hasMoney(100)",
      '  TriggerServerEvent("garages:store", "ABC123")',
      "  buildList()",
      "end",
      "",
      "function buildList()",
      "  return {}",
      "end",
      "",
    ].join("\n"),
    "resources/[g]/garages/server.lua": [
      "local function canStoreVehicle(userId, plate)",
      "  return plate ~= nil",
      "end",
      "",
      'RegisterNetEvent("garages:store", function(plate)',
      "  if canStoreVehicle(source, plate) then",
      '    print("ok")',
      "  end",
      "end)",
      "",
    ].join("\n"),
    "resources/[g]/bank/server.lua": 'exports("hasMoney", function(amount)\n  return true\nend)\n',
    "resources/[g]/shop/a.lua": "function dup()\nend\n",
    "resources/[g]/shop/b.lua": "function dup()\nend\nfunction caller()\n  dup()\nend\n",
  };
  function setup() {
    for (const [rel, text] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      fs.writeFileSync(path.join(root, rel), text);
    }
    const graph = atomic.buildAtomic(root);
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    const edges = graph.links.map((l) => ({ ...l, from: byId.get(l.source), to: byId.get(l.target) }));
    return { graph, edges };
  }
  const has = (edges, type, from, to) =>
    edges.find((e) => e.type === type && e.from.name === from && e.to.name === to);

  it("links emitters to handlers, calls to definitions and export calls to exports", () => {
    const { edges } = setup();
    const handled = edges.find((e) => e.type === "handled-by");
    assert.equal(handled.from.role, "emitter");
    assert.equal(handled.to.role, "handler");
    assert.ok(handled.to.file.endsWith("garages/server.lua"));
    assert.ok(has(edges, "emits", "openMenu", "garages:store"));
    assert.ok(has(edges, "calls", "openMenu", "buildList"));
    assert.ok(has(edges, "calls", "garages:store", "canStoreVehicle"));
    assert.ok(has(edges, "uses-export", "openMenu", "hasMoney"));
    const exp = edges.find((e) => e.type === "calls-export" && e.to.kind === "export");
    assert.equal(exp.confidence, "extracted");
    assert.ok(exp.to.file.endsWith("bank/server.lua"));
  });

  it("does not guess an ambiguous call target nor index one definition twice", () => {
    const { graph, edges } = setup();
    assert.equal(edges.filter((e) => e.type === "calls" && e.from.name === "caller").length, 1);
    assert.equal(has(edges, "calls", "caller", "dup").to.file, "resources/[g]/shop/b.lua");
    const opens = graph.nodes.filter((n) => n.kind === "function" && n.name === "openMenu");
    assert.equal(opens.length, 1);
  });

  it("expands a query through the code flow instead of unordered links", () => {
    setup();
    const result = atomic.queryAtomic(root, "onde dispara o evento garages:store", { budget: 800, refresh: false });
    const names = result.hits.map((hit) => hit.node.name);
    assert.ok(names.includes("garages:store"));
    assert.ok(result.hits.some((hit) => hit.node.role === "handler"));
    assert.ok(result.hits.some((hit) => hit.via === "calls" && hit.node.name === "canStoreVehicle"));
    for (const rel of result.related) {
      assert.ok(rel.hop >= 1 && rel.hop <= 2);
      assert.ok(!result.hits.some((hit) => hit.node.id === rel.id));
    }
    const scores = result.related.map((rel) => rel.score);
    assert.deepEqual(scores, [...scores].sort((a, b) => b - a));
  });

  it("never walks through a resource hub to unrelated symbols", () => {
    const { graph } = setup();
    const view = atomic.graphView(graph);
    const seed = graph.nodes.find((n) => n.name === "buildList");
    const related = atomic.expandFromSeeds(view, [seed.id], [], { limit: 50 });
    assert.ok(related.some((rel) => rel.kind === "resource" && rel.name === "garages"));
    assert.ok(related.some((rel) => rel.name === "openMenu" && rel.type === "calls"));
    // Same resource, but only reachable through the garages hub.
    assert.ok(!related.some((rel) => rel.name === "canStoreVehicle"));
  });
});
