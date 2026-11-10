# Retrieval benchmark

Run from the repository root (requires Node.js and `rg` on PATH):

```powershell
node eval/bench/run.js "C:\path\to\project" --n 150 --seed 7 --out result.json
```

The benchmark copies bounded source files into a temporary directory. It does not update the project's code, configuration, memory or existing graph. Only aggregate metrics and hashes are written to the output JSON, without source text.

It selects function/event names defined in exactly one file, splits their names into search terms, and checks whether retrieval returns that defining file. This evaluates ranking over extracted symbols; it does not independently evaluate extraction, natural-language task completion or an AI agent.

- Tokens are estimated as characters / 4; medians and p90 describe individual questions.
- `firstQueryMs` includes loading and preparing the index in a new process. `warmMsMedian` covers the remaining queries in the same process, matching a long-lived MCP server. Source-refresh checks are disabled for both versions to isolate retrieval.
- `corpusHash` identifies the copied/indexed source contents. With the same seed, equal `corpusHash` and `responseHash` show that both runs returned identical hits, ordering, scores, related nodes and token totals for the sampled queries.
- The broad baseline searches the longest word with ripgrep, then estimates tokens for reading every matching source file. The exact-file baseline estimates reading only the defining file. These are context-volume comparisons, not measured agent behavior.
- Wall-clock timings depend on the machine, filesystem cache and competing workloads. A warm-cache improvement is not a claim about the first query, indexing speed or complete MCP request latency.

For a paired comparison, save the previous `atomic-memory.js` as a temporary `.cjs` file beside it (so its relative imports still resolve), then pass `--compare scripts/lib/atomic-memory.before.cjs`. Both engines query the same frozen corpus in one process. `comparison.sameResponses` checks exact equality of the sampled answers. A mismatch sets a nonzero exit code; remove the temporary baseline file after the run.

## Paired cache evaluation — 2026-11-10

See `results/paired-cache.json`: 3,333 copied source files, 33,681 graph nodes, 150 questions, seed 7. The baseline came from commit `5067c99`'s `scripts/lib/atomic-memory.js` (before the cache change).

| Metric | Before | Cached queries |
| --- | ---: | ---: |
| Warm query median | 783.44 ms | 72.65 ms |
| Query p90 (all 150) | 1,085.56 ms | 129.10 ms |
| First query | 711.64 ms | 750.88 ms |
| Median context tokens | 242 | 242 |
| Correct file at rank 1 | 84% | 84% |
| Correct file in top 3 | 92% | 92% |

Warm retrieval was 10.8x faster (90.7% less time). Both engines produced the same response hash for all sampled hits, ordering, scores, related nodes and token totals. This comparison measures the retrieval engine, not complete MCP/agent latency. Cold loading did not improve.
