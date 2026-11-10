# Web principles — binding for every web change

Short rules with IDs. Cite the IDs in Gate A/B notes and in the Gate V `review` ("S1 S2 D1 ok; U1 n/a"). Details and examples live in `.fxmind/skills/web-development/` (`SKILL.md` maps each ID to its sections), `web-frontend/` and `web-backend/`; this file decides.

## Security — trust boundaries

- **S1 Validate at the boundary.** Every input that crosses a trust boundary (HTTP body/query/params/headers, form data, webhooks, queue messages, file uploads, `postMessage`) is parsed with a schema (type, length, range, enum, format) **once**, at the entry point, before any use. Reject unknown fields on writes. Client-side validation is UX only.
- **S2 Server owns authorization.** Every server entry point (route, server action, resolver, RPC, job triggered by a user) checks authentication **and** authorization for the specific resource (ownership/tenant/role), not just "is logged in". Hiding a button is not access control. Default deny.
- **S3 No secrets in the client, logs or repo.** Keys, tokens and passwords come from server-side env/secret store; never in bundles (`NEXT_PUBLIC_*`, `VITE_*` are public), URLs, logs, error messages or committed files. Log ids, not personal data.
- **S4 Injection-safe by construction.** Parameterized queries / ORM bindings only; no string-built SQL, shell commands, `eval`/`new Function`, or dynamic `require`/import from input. Render user content as text; `dangerouslySetInnerHTML`/`v-html`/`innerHTML` only with a sanitizer. Validate redirect targets and outbound URLs (open redirect, SSRF).
- **S5 Sessions and browser policy.** Cookies `HttpOnly` + `Secure` + `SameSite`; CSRF protection on cookie-authenticated mutations; CORS allowlist, never `*` with credentials; security headers (CSP, HSTS, `X-Content-Type-Options`) kept when present.
- **S6 Abuse limits.** Public and expensive endpoints (login, signup, password reset, search, uploads, AI/LLM calls, email/SMS) have rate limits and size limits; uploads check type, size and storage path.
- **S7 Dependencies are code.** No new dependency for what the platform, the standard library or an installed package already does; a needed one is maintained, pinned by the lockfile and not duplicated by another installed library.

## Architecture

- **A1 Respect the layers the project has.** UI → API/route handler → domain/service → data access. No DB/ORM calls from UI components; no HTTP/`req`/`res` objects inside domain logic; follow the folder/module conventions already in the repo instead of adding a parallel pattern.
- **A2 One source of truth per piece of state.** Server data lives in the server-state cache (React Query/SWR/loader/store the project uses); derived values are computed, not duplicated in state; URL state (filters, page, tab) lives in the URL.
- **A3 Explicit contracts.** Request/response, component props and events are typed (TypeScript types, schema, OpenAPI) and kept stable; breaking changes to a public contract are versioned or migrated with every caller updated.

## Data

- **D1 No queries in loops.** No N+1: batch with `IN (...)`/joins/`include`/dataloaders; select only the columns used.
- **D2 Bounded reads.** Every list endpoint paginates and caps `limit`; filters and sorts that run often have an index; no unbounded `SELECT *`/`findMany()` on growing tables.
- **D3 Atomic invariants.** Multi-write operations that must succeed together run in a transaction; money/stock/counters use atomic updates or locks, never read-modify-write across requests; idempotency keys on retried mutations and webhooks.
- **D4 Migrations are history.** Schema changes go through a new migration (never edit an applied one); destructive changes are staged (add → backfill → switch → drop) and reversible or explicitly approved.

## Performance

- **P1 Measure, then optimize.** Optimize what a profile, a query plan, the bundle report or a slow log shows; no speculative caching or memoization.
- **P2 Keep hot paths light.** No heavy work in render, request middleware or per-item loops; no blocking sync I/O on the Node event loop; long work goes to a queue/job. Ship less JS: code-split routes/heavy widgets, no full-library imports for one helper, optimized images with dimensions.
- **P3 Cache with an owner.** Every cache states its key, TTL and what invalidates it (the mutation that changes the data); never cache per-user data in a shared cache key.

## UI and accessibility

- **U1 Accessible by default.** Semantic HTML first (button for actions, a for navigation, label for inputs, headings in order); every interactive element is keyboard reachable with a visible focus; images have `alt`; color contrast meets WCAG AA; ARIA only to fill gaps, never to fake semantics.
- **U2 Every async state is designed.** Data views handle loading, empty, error and success; mutations disable double submit and show the result; errors tell the user what to do next without leaking internals.
- **U3 Responsive and resilient.** Layout works from 360 px to desktop without horizontal page scroll; text can grow; no layout shift from late content.

## Code — minimal and readable

- **C1 Minimal code.** Smallest change that meets Done; reuse the project's existing helpers, components, hooks and patterns. A new function/component/file must be reused or mark a real boundary. No single-use wrappers, generic managers, premature abstraction or config for values nobody changes.
- **C2 Readable flow.** Domain names, early returns, small functions with one job, no deep nesting, no clever metaprogramming; co-locate code by feature, never a `utils` dump.
- **C3 Errors are handled, not hidden.** No empty `catch`, no swallowed promise rejections, no `catch` that only logs and continues as success; await every promise or handle it explicitly; return/throw typed errors at the boundary.
- **C4 Clean diff.** No `console.log`/debug output, commented-out code, dead code, unrelated formatting or drive-by renames.
- **C5 Types are checks, not decoration.** No `any`, `as unknown as`, non-null `!` or `@ts-ignore`/`eslint-disable` to silence a real error; fix the type or narrow it with a guard.

## Tests

- **T1 Behavior changes carry a test.** A bug fix starts with a test that fails for the reported reason; a new behavior gets the smallest test at the lowest useful level (unit for logic, integration for API/DB, e2e only for critical flows). Never weaken or delete a test to make it pass.
- **T2 Tests are deterministic.** No real network, wall clock or random without control; no order dependence; no sleeps instead of awaits.

## Review question for every artifact

For each new endpoint, server action, component, query, job and function: is the input validated at the boundary (S1), who may call it and on which resource (S2), can it leak a secret or user data (S3), can input reach a query/HTML/shell unsafely (S4), how many queries and rows does it touch (D1/D2), what happens on partial failure or retry (D3), what does the user see while it loads or fails (U2), can a keyboard user operate it (U1), would the code be shorter without it (C1), and which test proves it (T1)?
