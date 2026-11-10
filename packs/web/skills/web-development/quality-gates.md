# Web Quality Gates — Definition of Done (task mode)

**Part of:** [best-practices.md](best-practices.md) index (one skill: `web-development`)
**When to read:** Gate A (design plan), Implement (while coding), **before Gate V** (self-review loop).

> **Audit vs quality-gates:** `/fxmind audit` is the **independent** post-hoc review. This file is the **author's checklist** while writing code. You cannot mark a check as pass without evidence in the diff or in command output.

The binding rule IDs (S1–S7, A1–A3, D1–D4, P1–P3, U1–U3, C1–C5, T1–T2) come from `.fxmind/policy/web-principles.md`; the tags below map each check to them.

| Topic | File |
|-------|------|
| Validation, authorization, secrets, injection | [security.md](security.md) |
| Layers, structure, state, contracts | [architecture.md](architecture.md) |
| Status codes, errors, pagination | [api.md](api.md) |
| Fetching, cache invalidation, mutations | [communication.md](communication.md) |
| Hot paths, bundle, caching | [performance.md](performance.md) |
| Naming, errors, types, clean diff | [style.md](style.md) |
| Test levels and determinism | [testing.md](testing.md) |
| UI, forms, accessibility | [../web-frontend/SKILL.md](../web-frontend/SKILL.md), [../web-frontend/accessibility.md](../web-frontend/accessibility.md) |
| Handlers, auth, jobs, DB | [../web-backend/SKILL.md](../web-backend/SKILL.md), [../web-backend/database.md](../web-backend/database.md) |

---

## Gate A — QUALITY plan (design review)

When the task touches web code, add a **QUALITY** block to Gate A (3–6 lines):

```
QUALITY:
  entry points: <new/changed routes, actions, components, jobs>
  auth:         <who may call each one + resource rule>                  (S2)
  input:        <schema per entry point; limits>                          (S1/S6)
  data:         <queries, pagination, transaction, migration?>            (D1–D4)
  ui:           <states loading/empty/error; a11y notes>                  (U1–U3)
  tests:        <test(s) that prove the behavior>                         (T1)
  reuse:        <existing helper/component/pattern reused, or why new>    (C1)
```

Skip rows that don't apply (write `n/a`). For a single-line fix, one QUALITY line is enough.

## Implement — while coding

| # | Check | IDs |
|---|-------|-----|
| I1 | Copied the conventions of the closest existing example (structure, naming, error format, libraries) | A1, C1 |
| I2 | Input parsed with a schema at the entry point; unknown write fields rejected | S1 |
| I3 | Auth + resource-level authorization inside every new/changed server entry point | S2 |
| I4 | Queries scoped by owner/tenant; no query in a loop; lists paginated and capped | S2, D1, D2 |
| I5 | Multi-write invariant in a transaction; retries idempotent | D3 |
| I6 | Schema change via a new migration only | D4 |
| I7 | No secret in client code, logs or responses; new env var added to `.env.example` | S3 |
| I8 | No raw HTML/SQL/shell built from input | S4 |
| I9 | Every data view has loading/empty/error; mutations prevent double submit | U2 |
| I10 | Semantic, labeled, keyboard-operable UI | U1 |
| I11 | Errors handled or propagated; no empty catch; promises awaited | C3 |
| I12 | Real types; no `any`/`@ts-ignore`/`eslint-disable` added | C5 |
| I13 | Cache invalidated by the mutation that changes the data | P3 |

## Self-review loop — before Gate V

Run on the **whole diff** (`git diff`), not on memory:

1. **Requirement coverage** — every Done item maps to code + a check.
2. **Callers** — every changed contract (route, props, exported function, DB column) has all callers updated (`fxmind_search`).
3. **Security pass** — I2, I3, I4, I7, I8 for every entry point in the diff.
4. **Failure paths** — invalid input, unauthorized, not found, network/DB failure: what happens?
5. **Lean pass** — for each new file/function/component/dependency/constant: what concrete reuse or boundary justifies it? Remove what fails the question (C1).
6. **Clean diff** — no debug output, commented code, unrelated changes (C4).
7. **Checks** — run lint, typecheck, focused tests (+ build when config/routing changed); record command + result.
8. **Observe** — API: one success + one failure request; UI: browser flow, console, keyboard, narrow viewport.

Repeat 1–8 until clean, then record Gate V.

## Gate V — review line

Cite IDs: `"S1 S2 D1 D2 U2 C1 T1 ok; D4 U1 n/a"` plus the checks that ran. Any ✗ → fix and rerun before V.
