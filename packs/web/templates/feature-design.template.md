---
resource: {{FEATURE}}
kind: create | refactor
status: draft | approved | built
stack: {{STACK}}
updated: {{DATE}}
---

# {{FEATURE}} — design

Compact English. Every row is a decision; "?" marks an open question for the user.

## Goal and Done

- Goal: one sentence.
- Done: observable behaviors (page flow, API response, job result) that prove it works.
- Out of scope: ...

## Current contract (refactor only — the invariants)

| Kind | Name | Notes (kept / changed: why) |
|------|------|------------------------------|
| route / page | `/orders/[id]` | kept |
| API endpoint | `POST /api/orders` | kept |
| server action / RPC | `createOrder` | kept |
| component (props/events) | `<OrderForm onSubmit>` | kept |
| exported function / hook | `useOrders()` | kept |
| DB table / column | `orders.status` | kept |
| job / queue / webhook | `orders.paid` | kept |
| env var / cache key | `PAYMENT_WEBHOOK_SECRET` / `orders:{id}` | kept |

## Files (minimal)

| File | Responsibility |
|------|----------------|
| `app/orders/page.tsx` | ... |
| `server/orders/service.ts` | domain logic only, no `req`/`res` |
| `server/orders/route.ts` | validation (S1) + authorization (S2) + call service |

## State ownership (A2)

| Data | Owner | Storage | Client access | Invalidated by |
|------|-------|---------|---------------|----------------|
| ... | server | DB | server cache (`useQuery(['orders'])`) | `createOrder` mutation |
| filters | URL | search params | `useSearchParams` | navigation |

## Endpoint contract (S1/S2/S6/A3)

| Method + path / action | Auth + authorization rule | Input schema | Response (success) | Errors | Rate / size limit |
|------------------------|---------------------------|--------------|--------------------|--------|-------------------|
| `POST /api/orders` | session; user owns cart | `{ cartId: uuid }` | `201 { id }` | 400 invalid, 401, 403, 409 | 10/min/user |

## Data access (D1–D4)

| Table | Read when / query | Index | Pagination | Written when | Transaction / idempotency |
|-------|-------------------|-------|------------|--------------|---------------------------|
| `orders` | list by user | `(user_id, created_at)` | cursor, max 50 | create | tx with stock decrement |

## UI (U1–U3)

- States: loading / empty / error / success for each data view.
- Accessibility: semantic elements, labels, focus order, keyboard path, contrast.
- Responsive: narrow viewport behavior.

## Background work (P2)

| Job / timer | Trigger | Retries / idempotency | Could it run inline or be event-driven? |
|-------------|---------|-----------------------|------------------------------------------|

## Security

- Per endpoint: who may call it, which resource it touches, input limits, secrets used (server only).

## Tests (T1)

| Behavior | Level (unit / integration / e2e) | File |
|----------|----------------------------------|------|

## Principles check

S1 … S7, A1 … A3, D1 … D4, P1 … P3, U1 … U3, C1 … C5, T1 … T2: how each is honored or `n/a` (one line each).

## Build slices

1. Slice — files, what becomes runnable, how it is verified.

## Open questions

- ?
