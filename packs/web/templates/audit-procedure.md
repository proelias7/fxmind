# Audit procedure — Web pack

Read-only diagnosis of a web feature, module, service or app. Every finding cites the violated principle ID from `.fxmind/policy/web-principles.md` (S1–S7, A1–A3, D1–D4, P1–P3, U1–U3, C1–C5, T1–T2) next to the skill section.

## Step 1 — Load standards

Read `.fxmind/policy/web-principles.md` first, then on demand from `.fxmind/skills/`:

| File | When |
|------|------|
| `web-development/security.md` | always (Pass 2) |
| `web-development/api.md` + `web-backend/SKILL.md` | API routes, server actions, jobs in scope |
| `web-backend/database.md` | ORM/SQL/migrations in scope |
| `web-development/performance.md` | always (Pass 4) |
| `web-frontend/SKILL.md` + `accessibility.md` | pages/components in scope |
| `web-development/style.md` + `architecture.md` | always (Pass 5) |
| `web-development/testing.md` | Pass 6 |

Read `.fxmind/reference.md` if present.

## Step 2 — Discover scope (Pass 0)

1. Resolve the unit: feature folder, route segment, package, or the whole app when asked. Record the exact file list (source only — skip `node_modules`, build output, generated files, lockfiles).
2. Read `package.json` (or backend manifest): framework, versions, scripts, validation/auth/ORM libraries.
3. Inventory **every externally callable entry point** in scope — the endpoint matrix rows:
   - HTTP routes (method + path) and route handlers
   - server actions / RPC procedures / GraphQL resolvers
   - webhooks, cron/queue consumers, websocket handlers
   - pages that read params/search params and render user data
4. For each entry point note: auth check, authorization rule, input validation, DB access, response shape.

🛑 AUDIT PASS 0 COMPLETE — scope and endpoint inventory recorded.

## Step 3 — Evaluate (evidence required)

### Pass 1 — Endpoint matrix (S1/S2/S6)

For **every** row from Pass 0: authentication (E-a), authorization on the specific resource — ownership/tenant/role (E-b), schema validation of every input source (E-c), rate/size limits where public or expensive (E-d), error responses without stack traces or internals (E-e). Missing authorization on a mutation → **Critical**. Missing validation on a mutation → **High**.

🛑 AUDIT PASS 1 COMPLETE

### Pass 2 — Security (S3–S5, S7)

- Secrets: hardcoded keys/tokens, secrets in client bundles (public env prefixes), secrets or PII in logs → Critical/High.
- Injection: string-built SQL/raw queries with input, `eval`/`new Function`, shell exec with input, unsanitized `dangerouslySetInnerHTML`/`v-html`/`innerHTML`, unvalidated redirect targets, server fetch of user-provided URLs (SSRF).
- Session/browser: cookie flags, CSRF on cookie-auth mutations, CORS (`*` + credentials), missing security headers when the project manages them.
- Uploads: type/size checks, storage path, public access.
- Dependencies: duplicated libraries, abandoned packages, known-vulnerable versions if `npm audit`/equivalent output is available.

🛑 AUDIT PASS 2 COMPLETE

### Pass 3 — Data (D1–D4)

- Queries inside loops / per-item fetches (N+1) — cite the loop and the query.
- Unbounded list reads (no pagination/limit), `SELECT *` on wide tables, filters/sorts without an index (check schema/migrations).
- Multi-write invariants without a transaction; read-modify-write on balances/stock/counters; webhook/mutation retries without idempotency.
- Edited applied migrations; destructive migrations without staging.

🛑 AUDIT PASS 3 COMPLETE

### Pass 4 — Performance (P1–P3)

- Server: blocking sync I/O in handlers (`readFileSync`, sync crypto, heavy JSON) on the request path; work that should be a job; caches without invalidation owner or keyed without the user.
- Client: data fetching waterfalls, fetching in `useEffect` when the framework has loaders/server components, unnecessary client components, heavy imports in the main bundle, missing image dimensions/optimization, re-render hot spots measured or obvious (new object/array props on every render to memoized children).

🛑 AUDIT PASS 4 COMPLETE

### Pass 5 — Architecture and code (A1–A3, C1–C5)

- Layer violations (DB from components, `req`/`res` in domain logic), parallel patterns that duplicate an existing one, state duplicated across stores.
- Contract types: untyped responses, `any`, `@ts-ignore`, `as unknown as`.
- Error handling: empty `catch`, unawaited promises, errors swallowed as success.
- Dead code, debug output, single-use wrappers, `utils` dumps.

🛑 AUDIT PASS 5 COMPLETE

### Pass UI — Accessibility and states (U1–U3) — mandatory when pages/components are in scope

- U-a semantic elements (clickable `div`s, missing `button`/`a`), U-b labels/`alt`/accessible names, U-c keyboard reachability and visible focus, U-d loading/empty/error states for each data view, U-e double-submit protection, U-f responsive breakpoints / horizontal scroll, U-g color contrast when measurable.

🛑 AUDIT PASS UI COMPLETE

### Pass 6 — Tests (T1–T2)

- Critical flows (auth, payments, permissions, data mutation) with no test; flaky patterns (real network, timers, order dependence); skipped tests.

🛑 AUDIT PASS 6 COMPLETE

### Severity

| Severity | Examples | Phase |
|----------|----------|-------|
| Critical | missing authorization on a mutation, injection with user input, exposed secret, auth bypass | 1 |
| High | missing input validation on writes, IDOR on reads of private data, N+1 on a hot list, unbounded list endpoint, missing transaction on money/stock | 2 |
| Medium | missing rate limit on a non-critical public endpoint, missing UI error state, accessibility blockers on secondary flows, untyped contracts | 3 |
| Low | style, dead code, minor performance | 4 |

## Step 4 — Write report

Save to **`.fxmind/audits/<name>.md`** (never at the `.fxmind/` root). Required sections:

1. Summary table — **counts must equal findings rows**
2. **Endpoint matrix** — every entry point with E-a…E-e (✓ / ✗ / n/a)
3. **UI matrix** (U-a…U-g) — when pages/components are in scope
4. Findings tables per pass: `ID | Severity | Principle | file:line | Evidence | Fix`
5. **Correction plan** — phased by severity (Critical→1 … Low→4)
6. **Files reviewed** — only files in scope, with line counts
7. **Self-check** — every pass marker reached, counts verified

Write the report in **Portuguese** if the codebase/comments are PT-BR; otherwise match the project language.

## Step 5 — Reply to user

- 3–5 bullet executive summary
- Count of findings by severity + files reviewed
- Top 3 fixes by priority
- Path to the full report
- Ask before implementing Phase 1 — **wait for approval before editing code**

## Audit rules

- **Never invent** findings — read `file:line` before citing.
- **Never treat UI hiding as authorization** — check the server entry point.
- **Never skip the endpoint matrix** — a page or server action that mutates data is an endpoint.
- **Never downgrade** missing authorization/validation because the app is "internal" or "small".
- **Never mismatch severity and phase.**
- **Never list files not in scope** under Files reviewed.
- Prefer concrete **before/after** snippets for every Critical/High finding.
- **Do not** auto-fix during audit mode.
