# FXMIND Atomic Memory Graph (v2)

## Purpose

The FXMIND memory layer is no longer limited to a single `garages.md`-style document per system. It indexes source symbols, events, SQL table references, small Markdown statements, and independently verified Gate V/C evidence as individually addressable nodes.

Existing Markdown is **never deleted, renamed or rewritten** during migration. It remains indexed as historical notes. New facts are recorded individually, with verified code evidence, through `/fxmind learn` or `fxmind memory add`.

## Migration

Run from any initialized project:

```powershell
fxmind memory migrate
# or from another directory:
fxmind memory migrate --target "C:\path\to\my-project"
```

The command builds:
- `graph/atomic-index.json`: incremental source and Markdown fragments, metadata, evidence, and typed relationships.
- `memory/atoms.json`: human/agent-learned, source-validated microfacts (created only when learning). This is team knowledge: it sits next to the Markdown memories and is committed with the project, so every agent and teammate shares it. One record per line, sorted by id, so parallel branches merge cleanly; writes are serialized with a file lock. Legacy `graph/manual-atoms.json` is still read and migrated on the next write.
- `graph/verified-atoms.json`: independently verified Gate V/C symbols (created when verified).
- `graph/knowledge-graph.json`: the existing graph enriched with atomic nodes and links.
- `graph/memory-index.json`: the legacy compatibility index.

In global-store mode these generated records live under `~/.fxmind/projects/<project-id>/graph/`. Only minimal FXMIND configuration is necessary in the project; links/copies depend on the existing global-store installation. When global-store is not enabled, the index remains under `.fxmind/graph/`.

## Retrieval

`fxmind_query` first uses the atomic index. Only the best three relevant snippets fit into the configured token budget; each includes its exact source file, line (when known), resource and source hash. Named-code lookup, PT/EN domain synonyms and one-hop relationships work without opening the entire topic Markdown. Existing section-based retrieval and bounded source search remain fallbacks when the index lacks coverage.

A source's stored timestamp and size are checked periodically on queries; Gate V/C and graph rebuilds refresh affected files incrementally.

Long-lived MCP processes reuse up to two recently queried indexes and prepare each node's search terms once per loaded index. Every query checks the index file's size, modification/change timestamps and file identity; a changed, deleted or invalid index discards its cached snapshot. Local/global storage paths remain separate. The ranking rules, token budget and source-freshness checks are unchanged. The first query after a reload still pays the parsing and preparation cost; separate CLI processes do not share this cache.

## Learning

After independently verified Gate V and C, FXMIND extracts source-exact records per discovered symbol and event in the changed files, stored in `graph/verified-atoms.json`. `/fxmind learn` stores one concise fact per verified claim through the existing `fxmind_graph` MCP tool's `addFact` argument in `memory/atoms.json`; the CLI also supports `fxmind memory add --topic garages --text "..." --path "..." --evidence "..."`. Both require evidence exactly present in an existing source file. Deduplication and source SHA-256 checking keep stale claims out of the active graph: when a file changes, a fact stays active only while its exact evidence still occurs in the current source (its line is recomputed). No broad snapshot is appended to `garages.md`.

Jev is optional and advisory: it can recommend whether to highlight a verified change, but cannot invent facts or stop local deterministic indexing. No source code or file paths are sent to Jev.

## Graph and panel

Each node has a stable ID, type, resource, evidence and source link. Relationships include `belongs-to`, `references-file`, `references-symbol` and `same-symbol`, plus directed code-flow edges: `handled-by` (`TriggerServerEvent`/`TriggerClientEvent`/`TriggerEvent` → `RegisterNetEvent`/`AddEventHandler` of the same event), `emits` and `uses-export` (enclosing function → emitter / `exports['res']:fn()` call), `calls-export` (call → `exports("fn", ...)` definition) and `calls` (function or handler body → function definition). A call resolves only to a unique target, preferring the same file, then the same resource; ambiguous names stay unlinked. Cross-file targets are `inferred` with a numeric `score`.

Queries seed from the best-scoring fragments (one extra seed per query term no hit covers), then walk up to two hops weighted by edge type, never through resource hubs. Direct code-flow neighbours (the handler of an emitted event, a called function) are added as evidence with leftover budget and marked `via`; the rest is listed in `related`, ranked, with `hop` and location. The Memories panel shows a condensed overview by default; typing a resource or symbol reveals matching nodes plus nearby connections. Selecting a node shows the exact snippet, provenance and backlinks.

## Limits and safety

The local scanner targets source extensions (Lua, JS/TS, Python, SQL) and skips asset/build/dependency directories, large files, obvious secrets and symlinks. It never executes source code. The source index is bounded to 12,000 files, 350 KB per code file and 160 symbols per file. Index misses must fall back to existing source search, not imply an absence.

Existing Git status, storage mode, manually written notes and MCP tool count are unchanged.
