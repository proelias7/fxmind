---
name: web-development
description: Web development best practices for any stack (React, Next.js, Vue, Nuxt, Svelte, Angular, Node/Express/Fastify/NestJS, Python, PHP). Covers security (validation, authorization, secrets, injection, sessions), architecture and layering, API contracts, client/server communication, performance and caching, readable minimal code, typing, error handling, testing, and quality gates for implementation/refactor. Use for any web app, website, API, dashboard or full-stack task, /fxmind audit on web code, or when no more specific web skill applies.
---

# Web Development — Best Practices

> Stack-agnostic orchestrator. **One skill** — load reference files on demand (do not load all).

**Language rule:** Internal reasoning is in compact English. All messages and output displayed to the user must be in the user's language.

## Philosophy

1. **Fetch, don't memorize** — framework APIs change between majors; read the docs for the **installed** version (`package.json`/lockfile) before using an API you are not sure about.
2. **Follow the project** — its folder layout, libraries, naming and patterns win over your preferences; copy the closest existing example, not a tutorial.
3. **Security is server-side** — validate at the boundary, authorize every server entry point, never trust the client.
4. **Minimal, readable code** — the smallest complete change; reuse before writing; no speculative abstraction.
5. **Evidence over claims** — lint, typecheck, focused tests and an observed run decide "done".
6. **Project memory** — `.fxmind/reference.md` = lean global map; `/fxmind learn` stores atomic, source-linked facts shared by every agent through git. Query memory before rescanning.
7. **Quality gates (task mode)** — implementing or refactoring follows [quality-gates.md](quality-gates.md): QUALITY plan at Gate A, self-review loop before Gate V.

---

## Reference router (load only what you need)

| Topic | File | Key sections |
|-------|------|--------------|
| Validation, authorization, secrets, injection, XSS, CSRF/CORS, uploads, rate limits | [security.md](security.md) | §1–§8 |
| Layers, folder structure, state ownership, dependencies | [architecture.md](architecture.md) | §1–§5 |
| HTTP/REST design, status codes, errors, pagination, versioning, idempotency | [api.md](api.md) | §1–§7 |
| Client ↔ server data flow, fetching, caching on the client, realtime | [communication.md](communication.md) | §1–§5 |
| Measuring, server hot paths, bundle size, rendering, caching | [performance.md](performance.md) | §1–§5 |
| Naming, functions, errors, types, comments, anti-patterns | [style.md](style.md) | §1–§7 |
| Test levels, what to test, deterministic tests, fixing failing tests | [testing.md](testing.md) | §1–§5 |
| **Implement / refactor (task mode DoD)** | [quality-gates.md](quality-gates.md) | Gate A QUALITY + self-review loop |
| **UI: components, state, forms, styling, accessibility** | [web-frontend/SKILL.md](../web-frontend/SKILL.md) · [accessibility.md](../web-frontend/accessibility.md) |
| **Backend: handlers, services, auth, jobs, database** | [web-backend/SKILL.md](../web-backend/SKILL.md) · [database.md](../web-backend/database.md) |
| Index of all § links | [best-practices.md](best-practices.md) | TOC only |

**Principle IDs → sections** (IDs from `.fxmind/policy/web-principles.md`; open only the row you need):

| ID | Rule | Details |
|----|------|---------|
| S1 | validate at the boundary | security §1 |
| S2 | server owns authorization | security §2; web-backend §3 |
| S3 | no secrets in client/logs/repo | security §3 |
| S4 | injection-safe (SQL, XSS, shell, redirects, SSRF) | security §4–§5 |
| S5 | sessions, cookies, CSRF, CORS, headers | security §6 |
| S6 | rate and size limits | security §7 |
| S7 | dependencies | security §8; architecture §5 |
| A1 | respect layers | architecture §1–§2 |
| A2 | one source of truth per state | architecture §3; communication §2; web-frontend §3 |
| A3 | explicit, stable contracts | api §1, §6; architecture §4 |
| D1–D4 | queries, bounds, transactions, migrations | web-backend/database.md §1–§5 |
| P1–P3 | measure, light hot paths, cache owner | performance §1–§5 |
| U1–U3 | accessibility, async states, responsive | web-frontend §4–§6; accessibility.md |
| C1 | minimal code | style §1; quality-gates |
| C2 | readable flow | style §2–§3 |
| C3 | errors handled | style §4; api §3 |
| C4 | clean diff | style §6 |
| C5 | real types | style §5 |
| T1–T2 | tests for behavior, deterministic | testing §1–§4 |

**Corrections backlog** (`.fxmind/corrections/`) categories map 1:1 to these files — promote rules into the matching file, not into a new skill.

---

## CRITICAL: No Hallucination Policy

**NEVER invent framework APIs, config options, CLI flags, hooks or library functions.**

1. Check the installed version in `package.json`/lockfile (or `composer.json`, `pyproject.toml`).
2. Unsure about an API → read the official docs for that major version (links in `.fxmind/policy/domain-routing.md`) or the library source in `node_modules`.
3. Function doesn't exist → say so and propose the real alternative.
4. Never assume a library is installed — check before importing; never add one silently (S7).

---

## Stack detection (quick)

| Signal | Stack |
|--------|-------|
| `next` + `app/` | Next.js App Router — server components by default, `"use client"` only where needed, server actions |
| `next` + `pages/` | Next.js Pages Router — `getServerSideProps`/API routes |
| `vite` + `react` | React SPA — client routing, data via fetch/React Query |
| `nuxt` / `vue` | Nuxt/Vue — composables, `useFetch`, Pinia |
| `@sveltejs/kit` | SvelteKit — `load` functions, form actions |
| `@angular/core` | Angular — services, DI, RxJS |
| `express` / `fastify` / `@nestjs/core` / `hono` | Node API |
| `laravel/framework` · `django` · `fastapi` · `rails` | PHP / Python / Ruby backends |

Package manager = the lockfile present (`pnpm-lock.yaml`, `yarn.lock`, `package-lock.json`, `bun.lockb`). Use it for every install/script.

---

## Workflow for any change

1. **Locate** — entry point, callers (`fxmind_search`), the closest existing example.
2. **Decide (Gate B)** — no code needed? existing helper/component? platform/library feature? only then new code.
3. **Implement** — follow the project's conventions; validate + authorize at the boundary; handle errors; keep types real.
4. **Verify** — lint, typecheck, focused tests (add one for the behavior), run the flow (API request / browser).
5. **Self-review** — [quality-gates.md](quality-gates.md) loop; then Gate V.
