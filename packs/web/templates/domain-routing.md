# Domain routing — Web

- Web: `.fxmind/policy/web-principles.md` is binding for every change (validation at the boundary, server-side authorization, no secrets in the client, injection-safe code, bounded queries, accessible UI, minimal code); then `web-development/quality-gates.md` rows for the touched artifacts and the relevant references.
- UI (components, pages, styles, forms, client state): `web-frontend/SKILL.md` (+ `accessibility.md`).
- API, server actions, jobs, auth, database: `web-backend/SKILL.md` (+ `database.md`) and `web-development/api.md`.
- Tests: `web-development/testing.md`.

Use the project's own scripts (`package.json` scripts, `Makefile`, `composer.json`, `pyproject.toml`) for lint, typecheck, test and build — read them, never guess commands. Never run destructive DB commands (reset, drop, migrate on a shared/production URL) without explicit approval; check which `DATABASE_URL`/env the command uses first.

## Unit of work and stack detection (Web)

- Unit = a **feature/module** (route segment, page, API resource, service, package in a monorepo); its scope is the feature folder plus every entry point and caller it exposes. Find callers with `fxmind_search` before changing a contract.
- Stack: read `package.json` (dependencies + scripts), the lockfile (`pnpm-lock.yaml` / `yarn.lock` / `package-lock.json` / `bun.lockb` — use that package manager), framework config (`next.config.*`, `vite.config.*`, `nuxt.config.*`, `svelte.config.*`, `angular.json`, `astro.config.*`), `tsconfig.json`, ORM schema (`prisma/schema.prisma`, `drizzle.config.*`, migrations folder), backend manifests (`composer.json`, `pyproject.toml`/`requirements.txt`, `go.mod`, `Gemfile`), monorepo files (`pnpm-workspace.yaml`, `turbo.json`, `nx.json`). Use the versions installed, not the latest docs by default.
- Contract inventory (refactor/design): every route/page, API endpoint (method + path), server action, GraphQL/RPC operation, exported component and its props/events, public hook/function, env var name, DB table/column, queue/job name, webhook and cache key — with `file:line`.
- Design tables (create/refactor): state ownership (server cache / URL / local / global store), endpoint contract (method, path, auth + authorization rule (S2), input schema (S1), response shape, errors, rate limit (S6)), data access (queries, indexes, pagination, transactions — D1–D3), UI states (loading/empty/error — U2), accessibility notes (U1), minimum files (C1/C2), tests (T1).
- Refactor slice order: tests that pin current behavior → data access (N+1, pagination, transactions) → API/contract (validation, authorization, errors) → UI (state, accessibility, bundle) → code cleanup.

## Help routing (Web)

- Framework/library API → official docs **for the installed version** (React https://react.dev, Next.js https://nextjs.org/docs, Vue https://vuejs.org, Nuxt https://nuxt.com/docs, Svelte https://svelte.dev/docs, Angular https://angular.dev, Node https://nodejs.org/docs, Express https://expressjs.com, Fastify https://fastify.dev, NestJS https://docs.nestjs.com, Prisma https://www.prisma.io/docs, Drizzle https://orm.drizzle.team, Laravel https://laravel.com/docs, Django https://docs.djangoproject.com, FastAPI https://fastapi.tiangolo.com).
- Web platform/HTML/CSS/accessibility → MDN https://developer.mozilla.org and WAI-ARIA APG https://www.w3.org/WAI/ARIA/apg/.
- Security → OWASP Cheat Sheets https://cheatsheetseries.owasp.org.
- Patterns → `web-development/SKILL.md` router; UI → `web-frontend`; API/DB → `web-backend`.

## Reference discovery (Web)

Stack and versions (package manager, framework, router style — e.g. Next App vs Pages Router), folder conventions (feature folders, `app/`, `src/`, `server/`, `lib/`), auth (provider, session vs token, where authorization is enforced), data layer (ORM, schema path, migrations command, seed), API style (REST/GraphQL/tRPC/server actions, validation library), state management (server cache, global store), styling (Tailwind/CSS modules/styled-components, design system/component library), env var names (`.env.example`, never values), scripts (dev, lint, typecheck, test, build, e2e), CI workflow, deployment target.

## Runtime verification (Web)

Run the project's lint, typecheck and the focused tests for the change; build when the change affects bundling, config or routing. API change → exercise the endpoint (test, `curl`, or the running dev server) including one failure case (invalid input / unauthorized). UI change → open the page in a browser, interact with the changed flow, check the console and network tab, test keyboard navigation and a narrow viewport. Missing dev server or credentials → UNVERIFIABLE; say exactly what the user must run.
