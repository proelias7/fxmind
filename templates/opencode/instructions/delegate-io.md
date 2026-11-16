# FxMind orchestration

Keep intent, architecture, task gates and final synthesis with the primary agent.

- Relevant preloaded context first; otherwise fxmind_query.
- Missing paths/symbols: fxmind_search in the likely directory.
- Known paths: read directly, or delegate independent substantial reads to reader.
- Unresolved discovery: explore with the specific missing question, already-known facts and bounded scope.
- Bounded implementation: general with exact task files, local conventions, Done and verification expectations. Include the Lean decision: reuse existing helpers/components/events and standard/platform APIs before adding new abstractions, and preserve tests, security and callers. This is context, not a separate MCP query or gate.
- External documentation: scout with the exact API question.
- Independent review is optional and read-only. Run it only when requested; otherwise perform focused checks and close the task normally.

Use repository-relative paths. Reuse parent sessionId; subagents never start tasks, record gates or run Judge. Do not delegate the same read/search to multiple agents.

Quick mode avoids delegation overhead for small work. All modes retain diff review and real checks. Before UI success, the primary agent must inspect browser evidence and ensure observed defects were corrected.
