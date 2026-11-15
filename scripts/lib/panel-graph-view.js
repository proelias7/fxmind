"use strict";

/**
 * Small, confirmed-link-only projection of an existing knowledge graph.
 * The full graph can have 30k+ symbols, so never transmit it to the browser
 * solely to draw the memory canvas.
 */
const MAX_NODES = 420;
const norm = x => String(x == null ? "" : x).toLowerCase();

function graphMemoryView(graph, opts = {}) {
  const mode = opts.mode === "fragments" ? "fragments" : "memories";
  const limit = Math.min(MAX_NODES, Math.max(10, Number.parseInt(opts.limit, 10) || (mode === "fragments" ? 300 : 180)));
  const query = norm(opts.query).trim().slice(0, 120);
  const all = Array.isArray(graph.nodes) ? graph.nodes : [];
  const links = Array.isArray(graph.links) ? graph.links : [];
  const learned = all.filter(n => n && n.group === "learned");
  const atom = all.filter(n => n && n.group === "memory-atom");
  const resource = all.filter(n => n && n.group === "resource");
  const buckets = new Map();
  for (const n of atom) {
    const key = String(n.slug || n.topic || n.resource || "");
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(n);
  }
  // Round-robin across topics to prevent the first large memory file from
  // consuming the entire detail budget (e.g. Boxes, Garages, HUD, ...).
  const spreadAtoms = [];
  while ([...buckets.values()].some(group => group.length)) {
    for (const group of buckets.values()) if (group.length) spreadAtoms.push(group.shift());
  }
  const memoryNames = new Set(learned.map(n => String(n.id).toLowerCase()));
  const relatedResources = resource.filter(n => memoryNames.has(String(n.name || n.resource || "").toLowerCase()));
  const allowed = mode === "memories" ? learned : [...learned, ...relatedResources, ...spreadAtoms];
  const searchable = n => norm([n.name, n.id, n.topic, n.slug, n.resource, n.content, n.triggers].join(" "));
  const matches = query ? new Set(allowed.filter(n => searchable(n).includes(query)).map(n => String(n.id))) : null;
  const related = new Set(matches || []);
  if (matches) {
    for (const edge of links) {
      const source = String(edge.source?.id || edge.source);
      const target = String(edge.target?.id || edge.target);
      if (matches.has(source)) related.add(target);
      if (matches.has(target)) related.add(source);
    }
    const topics = new Set(allowed.filter(n => matches.has(String(n.id))).map(n => String(n.slug || n.topic || n.resource || n.id)));
    for (const n of allowed) if (topics.has(String(n.slug || n.topic || n.resource || n.id))) related.add(String(n.id));
  }
  const candidates = allowed.filter(n => !matches || related.has(String(n.id)));
  const chosen = candidates.slice(0, limit);
  const ids = new Set(chosen.map(n => String(n.id)));
  const edges = [], seen = new Set();
  function push(source, target, type) {
    if (!ids.has(source) || !ids.has(target) || source === target) return;
    const key = source + "\u0000" + target + "\u0000" + type;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({ source, target, type });
  }
  // Incoming graph links are already confirmed and validated by panel-api.
  for (const edge of links) push(String(edge.source?.id || edge.source), String(edge.target?.id || edge.target), String(edge.type || edge.kind || "related"));
  if (mode === "fragments") {
    const parentIds = new Set(chosen.filter(n => n.group === "learned").map(n => String(n.id)));
    for (const n of chosen) {
      if (n.group !== "memory-atom") continue;
      const parent = String(n.slug || n.topic || n.resource);
      if (parentIds.has(parent)) push(parent, String(n.id), "fragment-of");
    }
  }
  return {
    ok: true, mode, query,
    nodes: chosen.map(n => ({
      id: String(n.id),
      name: n.group === "memory-atom"
        ? (String(n.content || n.name || "Fragmento").replace(/^[\s*#>-]+/, "").replace(/\s+/g, " ").trim().slice(0, 84))
        : String(n.name || n.topic || n.id).slice(0, 100),
      group: n.group,
      topic: String(n.topic || n.slug || n.resource || n.name || "").slice(0, 90),
      content: String(n.content || "").slice(0, 550),
      file: String(n.file || "").slice(0, 260),
      line: Number(n.line || 0),
      resource: String(n.resource || "").slice(0, 90),
      updated: String(n.updated || "").slice(0, 30),
    })),
    links: edges,
    meta: {
      totalMemories: learned.length, totalFragments: atom.length,
      visibleNodes: chosen.length, visibleLinks: edges.length,
      truncated: candidates.length > chosen.length,
      generatedAt: graph.meta?.generatedAt || null,
    },
  };
}
module.exports = { graphMemoryView, MAX_NODES };
