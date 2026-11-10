# Architecture — web

Principles A1–A3 (and S7, C1, C2) from `.fxmind/policy/web-principles.md`.

## §1 Layers (A1)

Typical flow — use the names the project already has:

```
UI (page/component)  →  API boundary (route handler / server action / controller)
                     →  domain (service / use case)  →  data access (repository / ORM)
```

- **UI**: rendering, user interaction, client state. No DB/ORM, no secrets, no business rules that must be enforced.
- **API boundary**: parse + validate input (S1), authenticate + authorize (S2), call the domain, map results/errors to HTTP. Thin.
- **Domain**: business rules, invariants, orchestration. Pure functions where possible; no `req`/`res`, no framework objects, no HTTP status codes.
- **Data access**: queries, transactions, mapping. No HTTP concerns.
- Small apps may collapse domain + data access into one module — don't add layers the project doesn't need (C1). Do keep validation/authorization at the boundary.

## §2 Follow the existing structure

- Find the closest existing feature and mirror its layout (feature folders, `app/` routes, `server/`, `lib/`, `modules/`).
- Never introduce a parallel pattern (a new fetch wrapper when one exists, a second error format, a new state library).
- Co-locate by feature: component + hook + test + styles of a feature live together; shared code moves to a shared folder only when a second feature uses it.
- No `utils.ts` dumping ground — name modules by domain (`money.ts`, `dates.ts`, `orders/permissions.ts`).
- Respect import boundaries: client code never imports server-only modules (use `server-only`/framework conventions); packages in a monorepo import through their public entry.

## §3 State ownership (A2)

| State | Lives in |
|-------|----------|
| Data from the server | server-state cache (React Query/SWR/loaders/server components/Pinia store fed by API) |
| Shareable UI state (filters, page, tab, selected id) | URL (search params / route params) |
| Form drafts | form library state |
| Ephemeral UI (open/closed, hover) | local component state |
| Cross-cutting client state (theme, auth user snapshot) | the project's global store/context |

- Derived values are computed (`const total = items.reduce(...)`), not stored and synced with effects.
- Don't copy server data into a global store and mutate it there; invalidate/refetch or use the cache's optimistic update API.

## §4 Contracts (A3)

- Types for request/response come from one place (shared schema → inferred types, OpenAPI codegen, tRPC, GraphQL codegen). Don't hand-write the same type twice on client and server.
- Public contracts (API routes used by other apps, exported package functions, component props in a design system, webhooks, events) change compatibly: add optional fields, keep old ones; breaking changes go behind a new version or migrate all callers in the same change.
- Env vars are part of the contract: add new ones to `.env.example` and the env validation schema (if the project has one).

## §5 Dependencies and boundaries (S7)

- Inject external services through the module the project uses (a `lib/stripe.ts` client, a provider) — one place to configure, mock and replace.
- Wrap a third-party SDK only when it gives a concrete benefit (one configured instance, typed subset, test seam); not as a generic pass-through layer.
- Feature flags/config only for values that really change per environment or customer.

## Anti-patterns

- God components/services (hundreds of lines doing fetch + validation + rendering + business rules).
- Business rules enforced only in the UI.
- Circular imports between features; shared folder that imports from features.
- "Manager"/"Helper"/"Base" classes with one implementation.
