# API design — web

Principles A3, S1, S2, S6, C3, D2, D3 from `.fxmind/policy/web-principles.md`. Follow the project's existing API style (REST, GraphQL, tRPC, server actions) and error format first; these rules fill gaps.

## §1 Resources and methods

- Nouns for resources, HTTP methods for actions: `GET /orders`, `GET /orders/:id`, `POST /orders`, `PATCH /orders/:id`, `DELETE /orders/:id`. Actions that are not CRUD: `POST /orders/:id/cancel`.
- `GET`/`HEAD` are safe (never mutate); `PUT`/`DELETE` are idempotent; `POST` is not — add an idempotency key where clients retry (payments, order creation).
- Keep URL shapes and naming consistent with the existing routes (plural/singular, kebab/camel, `/api/v1` prefix).

## §2 Status codes

| Situation | Code |
|-----------|------|
| read ok / update ok with body | 200 |
| created | 201 (+ `Location` or the id) |
| accepted for async processing | 202 |
| success, no body | 204 |
| invalid input / failed schema | 400 (or 422 if the project uses it) |
| not authenticated | 401 |
| authenticated but not allowed | 403 (or 404 to hide existence) |
| not found | 404 |
| conflict / duplicate / stale version | 409 |
| rate limited | 429 (+ `Retry-After`) |
| unexpected server error | 500 — generic message, details only in server logs |

Never return 200 with `{ error }` for a failure unless the project's convention (e.g. GraphQL) requires it.

## §3 Errors (C3)

- One error shape across the API, e.g. `{ "error": { "code": "invalid_input", "message": "...", "details": {...} } }` — reuse the project's.
- Machine-readable `code` for clients; human `message` safe to show; field-level `details` for validation.
- Map domain errors to HTTP at the boundary (a `NotFoundError` → 404); don't throw HTTP errors from the domain layer.
- Catch only what you can handle; let the framework's error handler log unexpected errors with a request id.

## §4 Pagination, filtering, sorting (D2)

- Every list endpoint paginates. Cursor pagination (`?cursor=…&limit=…`) for feeds and large/changing tables; offset (`?page=&pageSize=`) acceptable for small admin lists.
- Cap `limit` server-side (e.g. max 100) and set a default.
- Filters and sort fields come from an allowlist; sort keys map to indexed columns.
- Return the pagination info (`nextCursor`, `hasMore` or `total` when cheap).

## §5 Responses

- Return only the fields the client needs; never serialize whole ORM entities (leaks `passwordHash`, internal flags). Use a select/DTO/serializer.
- Consistent naming (camelCase JSON unless the project differs), ISO-8601 UTC dates, money as integer minor units or decimal strings — never floats.
- Large or slow operations → 202 + job id + status endpoint, or streaming, instead of a long request.

## §6 Versioning and compatibility (A3)

- Additive changes are compatible: new optional fields, new endpoints.
- Breaking: removing/renaming fields, changing types or meaning, new required input. Version (`/v2`, header) or update every caller in the same change and say so.
- Deprecate before removing when external clients exist.

## §7 Webhooks and idempotency (D3, S6)

- Verify the signature using the raw body and the provider SDK; reject old timestamps.
- Process idempotently: store the event id, ignore duplicates; respond 2xx fast and do heavy work in a job.
- Outbound webhooks: sign payloads, retry with backoff, let receivers deduplicate by id.

## GraphQL / tRPC / server actions notes

- Each resolver/procedure/action is an endpoint: validate input and authorize inside it.
- GraphQL: limit query depth/complexity, use dataloaders to avoid N+1, don't expose internal fields in the schema.
- Server actions: they are POST endpoints callable by anyone with the action id — auth + validation inside; return typed results, revalidate the affected paths/tags.
