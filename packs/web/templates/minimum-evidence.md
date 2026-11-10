# Minimum evidence set — Web pack

Binding for agents when the task is web work. **Open these before editing behavior** (Gate B / Implement). Changes nouns only; the Task loop stays the same.

## Must open (every non-trivial web task)

1. **`.fxmind/policy/web-principles.md`** — binding rules (S/A/D/P/U/C/T IDs).
2. **`package.json`** (or the backend manifest) — scripts, framework and library versions actually installed.
3. **`.fxmind/reference.md`** if present (project map / conventions / anti-bug notes).
4. Matching memories via `fxmind_query` (3–5 max) — or state none matched.
5. The **entry point and its callers**: route/page/handler being changed and every caller found with `fxmind_search`.
6. The **closest existing example** of the same kind (another endpoint, form, component) to copy conventions from.

## Must open when the topic matches

| Topic | Open |
|-------|------|
| Auth / permissions / tenant / payments / uploads / webhooks | `web-development/security.md` + the existing auth middleware/guard |
| API endpoint / server action / contract change | `web-development/api.md` + `web-backend/SKILL.md` |
| Query / schema / migration / transaction | `web-backend/database.md` + the ORM schema and latest migrations |
| Component / page / form / styling | `web-frontend/SKILL.md` + `web-frontend/accessibility.md` |
| Slow page / bundle / caching | `web-development/performance.md` |
| Tests to add or fix | `web-development/testing.md` + an existing test of the same kind |
| Audit request | `.fxmind/audits/procedure.md` (not this file) |
| New feature/module | `.fxmind/modes/create.md` + `.fxmind/templates/resource-design.md` |
| Large rewrite | `.fxmind/modes/refactor.md` (+ `.fxmind/audits/<name>.md` if present) |

## Authority order (Web)

Explicit user statement > `.fxmind/memory/*` + `reference.md` > project conventions in current code > pack skill docs > official framework docs for the installed version.

## Verify by observation

- Lint + typecheck + focused tests pass, with output recorded (not "should pass").
- API change → one success and one failure request observed (invalid input → 4xx with no stack trace; unauthorized → 401/403).
- UI change → page opened in a browser, changed flow exercised, console clean, keyboard path checked.
- Migration → applied on a local/dev database only, and reversible or approved.
- Cannot verify → UNVERIFIABLE, never "should work".

## Fraud table (Judge hunts these)

- "Tests pass" without the command output, or tests skipped/deleted/weakened (`.skip`, `only`, loosened asserts)
- Authorization only in the UI (button hidden) while the endpoint accepts anyone
- `any` / `@ts-ignore` / `eslint-disable` added to make the check green
- String-built SQL or `dangerouslySetInnerHTML`/`v-html` with user input
- Secrets or `.env` values committed, logged or exposed through public env prefixes
- `console.log`/debug output left behind; commented-out code
- New dependency for something already available
- Scope creep across unrelated features, mass reformatting
