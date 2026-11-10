---
name: web-backend
description: Builds web backends and APIs — Node.js (Express, Fastify, NestJS, Hono, Next.js route handlers/server actions), Python (FastAPI, Django), PHP (Laravel) and similar. Covers route handlers, services, authentication and authorization, input validation, error handling, background jobs and queues, configuration, logging, and databases (ORM, SQL, transactions, migrations). Use when the user mentions API, endpoint, route, controller, server, backend, auth, login, database, SQL, Prisma, Drizzle, migration, queue, worker, cron or webhook.
---

# Web Backend

> Load [database.md](database.md) for any query, schema or migration. API shape rules live in [../web-development/api.md](../web-development/api.md); security details in [../web-development/security.md](../web-development/security.md).

Principles: S1–S6, A1, A3, D1–D4, P2, P3, C3 from `.fxmind/policy/web-principles.md`.

## §1 Route handlers / controllers (A1, S1, S2)

Every handler, in this order:

1. **Authenticate** — the project's session/token helper or guard.
2. **Validate** — parse params/query/body with the schema library; 400 on failure.
3. **Authorize** — the user may perform this action on this resource (ownership/tenant/role).
4. **Call the domain/service** with typed input.
5. **Map** the result or domain error to the HTTP response (status + project error shape).

Keep handlers thin; no business rules duplicated across handlers. Reuse the framework mechanisms (NestJS pipes/guards/interceptors, Fastify schemas/hooks, Express middleware, Laravel FormRequest/Policies, FastAPI dependencies, Django permissions).

## §2 Services / domain (A1)

- Business rules and invariants live here, framework-free: no `req`/`res`, no HTTP codes, no direct reads of `process.env` scattered around (inject config).
- Functions take explicit inputs (including the acting user when rules depend on it) and return results or throw typed domain errors (`NotFoundError`, `ForbiddenError`, `ConflictError`).
- Side effects (emails, webhooks, events) after the transaction commits, or via an outbox/job.

## §3 Authentication and authorization (S2, S5)

- Use the existing auth provider/library (NextAuth/Auth.js, Lucia, Clerk, Passport, Sanctum, Django auth); don't hand-roll sessions, JWT verification or password hashing.
- Authorization helpers per resource (`canEditOrder(user, order)`) or policies — one place, reused by every entry point and tested.
- Multi-tenant: every query filtered by tenant id taken from the session, never from the request body.
- JWT: verify signature, `exp`, issuer/audience; short-lived access tokens; never accept `alg: none`.

## §4 Background jobs and queues (P2, D3)

- Work that can be deferred (email, image processing, exports, third-party sync) goes to the project's queue (BullMQ, SQS, Celery, Laravel queues, cron routes).
- Jobs are idempotent (safe to retry), have bounded retries with backoff, and a dead-letter/failure log.
- Payloads carry ids, not large objects; the job re-reads current state.
- Scheduled jobs guard against overlapping runs (lock) and process in batches.

## §5 Configuration (S3)

- Env vars validated at startup (zod/envalid/pydantic settings) when the project has a schema; fail fast on missing required config.
- New env var → add to `.env.example` (name + description, no value) and to the validation schema.
- Never log config values; never send them to the client.

## §6 Logging and errors (C3, S3)

- Use the project's logger with levels; structured fields (`requestId`, `userId`, `orderId`), no secrets/PII.
- One global error handler converts unexpected errors to 500 with a generic message and logs the stack with the request id.
- Don't catch-and-ignore; don't log the same error at every layer.

## §7 Outbound calls

- Timeouts on every HTTP call to third parties; retries only for idempotent requests, with backoff.
- Validate third-party responses you depend on (they are untrusted input too).
- Wrap each provider in one configured client module (`lib/stripe.ts`) — single place to mock in tests.

## §8 Verification (backend)

Run lint, typecheck and the focused tests; exercise the endpoint with one success and one failure (invalid input, unauthorized) via a test, `curl`, or the dev server; for DB changes apply the migration on a local database and check the query plan when performance matters.
