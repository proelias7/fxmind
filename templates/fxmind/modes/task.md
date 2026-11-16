# fxmind — Task

Use for requested code/config changes, including "analyze and fix". Questions and review-only requests stay read-only. Plan-first applies when the user requested a plan or a material decision is missing; existing authorization remains valid. User stop cancels further work immediately.

## Classify and define success

State the goal, scope, observable Done criteria and checks in a short note. For defects, identify the cause and one concrete reproduction before editing. For behavior changes, compare current behavior, expected behavior and the relevant spec; surface conflicts. Preserve explicit user decisions. For refactors, record INVARIANTS.

Quick mode reduces lookup and narration, not correctness. Use `trivial: true` only for a known one-file, roughly <10-line edit with no new behavior or discovery. UI, security, data mutations and unknown scope are not trivial. Otherwise use normal A/B, even in quick mode.

Read `.fxmind/modes/task-verify.md` before implementation when UI/runtime evidence is needed, so verification is feasible before coding.

## Kind and playbook

Every task has a **kind**; it decides how context loads. State `KIND: <kind>` in Gate A (the preload gives a first guess — correct it when wrong) and pass `kind` to `fxmind_start_task`.

| kind | What it is | Context to load | Extra rules |
|------|-----------|-----------------|-------------|
| `config` | Register/change a data entry: item, skin, price, permission, list row | **Playbook** if one matched; else memory `Files` + `Recipe` only | No design, no broad search. If no playbook existed and it worked, offer `/fxmind teach <name>` at Gate C |
| `fix` | Defect: error, "não funciona", wrong result | Memory `Files` + `Pitfalls` + `symbols[]` matching the error, recent `corrections`, console tail | Reproduce first, name the cause, run TWINS |
| `mechanic` | Change how existing behavior works | Whole memory flow + graph neighbours (callers, events, exports) + relevant principle IDs | INTENT (code / check / spec) before editing |
| `create` | New resource | `.fxmind/modes/create.md` | Design + approval first |

**Playbook** (`.fxmind/playbooks/<id>.md`): the preload injects a `# fxmind — playbook` block when the request matches one — files, current line numbers of the anchors, snippets, verify checks and the related memory Pitfalls. It replaces discovery:

1. Confirm the request fits the playbook and collect its inputs; ask only for what is missing.
2. `fxmind_start_task { kind, playbook }`. A **verified** playbook auto-completes Gates A and B; a `draft` one still records A/B normally. C can close directly after checks.
3. Read ~25 lines around each listed anchor, edit, then run the playbook's `Verify` checks before closing. Skip `fxmind_query` and repository search.
4. File or anchor not found, or the code contradicts a step → stop, say so, continue with the memory flow, and at Gate C fix the playbook (`.fxmind/modes/teach.md`). Never edit at a guessed location.

`fxmind_playbook` (MCP) lists, matches, shows and checks playbooks when the preload did not include one but the request looks like a repeated task.

## Start and context (A → B)

1. `fxmind_start_task` with a compact goal note and `ui: true` only when visual/interaction changes are expected. This is a planning hint; verify actual UI impact after editing, and do not open a browser for unchanged interfaces. Keep the returned sessionId and pass it to gate/claim calls. Reuse FXMIND_SESSION_ID from panel context when supplied.
2. Gate A: record scope, Done, checks, INTENT/invariants when applicable in `fxmind_record_gate` note. From Gate A on, user-facing replies stay short and direct — lead with the outcome, no long explanations or gate ceremony. Trivial tasks auto-complete A/B but still need verification.
3. Gate B: use relevant preloaded memories; otherwise query once (~1200–1500 tokens). Memories guide discovery; current source confirms them. Read implementation, callers and nearby conventions before editing. **Lean choice:** before writing, decide whether the requested behavior needs new code at all; first reuse a verified existing helper, event, component or playbook, then native platform/standard-library capability, then an installed dependency. Only add the smallest complete implementation if these cannot satisfy Done. The optional symbol map suggests candidate files (including Lua events and exports) but is not authoritative; inspect callers and actual flow. Record the choice and a focused regression check in the existing Gate B note, never as a new gate.
4. If hits are missing/stale, use one bounded path/symbol search in the likely folder and read the results. Widen only when evidence requires it; no repeated repository dumps. If this provider denies native search, use an available permitted tool/subagent; don't evade its permissions.
5. Load only relevant pack references/corrections. Read the installed pack principles (binding; `.fxmind/policy/domain-routing.md` names them — e.g. `fivem-principles.md`, `web-principles.md`), then the pack `quality-gates.md` rows for the artifacts you touch and the affected domain references; for each new/changed entry point (event, callback, route, endpoint, component, loop, query, job) note callers/recipients, payload size, frequency, data access and authorization. Verify unfamiliar APIs from primary sources.
   A new resource/feature/module belongs in `.fxmind/modes/create.md`; a rewrite of most of one in `.fxmind/modes/refactor.md`.
6. Record B with paths, relevant rules and unresolved risks. After B, claim all task files before edits when sessions run in parallel.

Use MCP for gates, memory/graph and available domain operations. Missing MCP blocks gate-controlled implementation; report the missing capability. Read-only investigation can continue. Never write gate/session JSON directly.

## Implement and simplify

- Choose the smallest implementation that satisfies Done and matches nearby code. Reuse an existing pattern before adding a new layer.
- A new constant should name domain meaning, coordinate a repeated value or provide a real configuration point. Keep obvious one-use literals inline; do not hoist every string, CSS class, label or number into a constants block.
- Extract helpers for actual reuse or a meaningful lifecycle/domain boundary. Avoid single-use forwarding wrappers, speculative factories, generic configuration systems and extra files with no concrete responsibility. Preserve useful existing abstractions.
- Validate at actual trust boundaries. Do not scatter redundant guards, coercions, catches or fallbacks that hide defects; preserve required security checks.
- Comments explain non-obvious reasons. Remove narration, debug output, dead code and unrelated formatting churn.
- Before every fix, state the failing observation and a testable hypothesis internally. Change one cause, then rerun the relevant check. After repeated failure with no new evidence, change the diagnostic approach. Three attempts with the same hypothesis → report the unresolved blocker, never pretend success.
- Reuse successful checks while the relevant code is unchanged. Batch independent reads/checks; delegate only separable work with a clear result and useful time savings. Avoid delegation for tiny tasks.
- No unrelated changes or new dependencies for convenience. Respect existing authorization for commits/push/deploy; ask only for actions outside it.

FiveM local verification: call `fxmind_fivem_status` before commands. If available, run ensure/restart and console tail yourself when runtime behavior changed. Only for actual NUI visual/interaction changes, inspect DOM/state with wire → dump → unwire and visually inspect the actual runtime; desktop browser alone does not prove CEF rendering. Missing runtime blocks only checks that require it; do not open NUI for unchanged interface outcomes. Install missing dev integration once when within scope and report any required server restart. Never target production implicitly.

Scratch belongs in OS temp or a session-owned path. Clean up only files this task created; never delete a shared tmp directory used by other sessions.

## Review, verify and finish (C)

Review the task diff for requested behavior, invariants, error paths and unnecessary complexity. Run the applicable syntax/typecheck, focused tests and runtime validation. For actual visual or interaction changes, verify with the browser and inspect real evidence; report checks that could not be run.

Optional independent review (`fxmind_independent_review`) may be requested explicitly. It is never automatic or a prerequisite for completion.

When the work is complete, call `fxmind_record_gate` with `gate: "C"` and the sessionId to release claimed files. No other review gate is required. Save reusable project knowledge when appropriately verified, without inventing observations.

Final reply: actual outcome, succinct checks and only relevant blockers.
