# Database — web backend

Principles D1–D4 (and S4, P1) from `.fxmind/policy/web-principles.md`. Use the ORM/driver the project already uses (Prisma, Drizzle, TypeORM, Sequelize, Knex, Eloquent, Django ORM, SQLAlchemy).

## §1 No queries in loops (D1)

```ts
// ❌ N+1
for (const order of orders) order.items = await db.item.findMany({ where: { orderId: order.id } });

// ✅ one query
const orders = await db.order.findMany({ where: { userId }, include: { items: true }, take: 50 });
// ✅ or batch: findMany({ where: { orderId: { in: ids } } }) and group in memory
```

- GraphQL resolvers use dataloaders; serializers must not lazy-load relations per row (Django `select_related`/`prefetch_related`, Laravel `with()`, SQLAlchemy `selectinload`).
- Select only the columns used (`select`, `only()`), especially on wide tables and lists.

## §2 Bounded reads and indexes (D2)

- Every list query has a `limit`/`take` (capped) and pagination; cursor pagination on large or growing tables.
- Columns used in frequent `WHERE`, `JOIN`, `ORDER BY` have indexes (composite in the right order: equality columns first, then range/sort). Check with `EXPLAIN` for the queries you add.
- Avoid `LIKE '%term%'` on large tables without a full-text/trigram index; avoid functions on indexed columns in `WHERE`.
- Counting exact totals on huge tables is expensive — return `hasMore` instead when the UI allows.

## §3 Transactions and concurrency (D3)

- Operations that must all succeed (order + stock decrement + payment record) run in one transaction (`$transaction`, `db.transaction`, `DB::transaction`, `atomic()`).
- Never read-modify-write a counter/balance across statements without a lock: use atomic updates (`UPDATE ... SET stock = stock - 1 WHERE id = ? AND stock > 0`, `increment`) or `SELECT ... FOR UPDATE`, or optimistic locking with a version column.
- Unique constraints enforce uniqueness — handle the conflict error (409) instead of check-then-insert races.
- Keep transactions short: no network calls (emails, HTTP) inside; do them after commit.
- Retries and webhooks use idempotency keys stored with a unique constraint.

## §4 Migrations (D4)

- Every schema change is a new migration generated with the project tool (`prisma migrate dev`, `drizzle-kit generate`, `php artisan make:migration`, `alembic revision`, `manage.py makemigrations`). Never edit a migration that was already applied/shared.
- Destructive or locking changes on populated tables are staged: add nullable column → backfill in batches → switch reads/writes → add constraint → drop old column in a later release.
- Adding an index on a big table: use the concurrent option when the database supports it.
- Commit the generated migration and the updated schema together; describe data impact in the review.
- Run migrations only against local/dev databases unless the user explicitly approves another target — check the connection string the command uses first.

## §5 ORM and SQL pitfalls (S4)

- Raw SQL only with parameters (`$queryRaw` tagged template, `sql\`\`` with placeholders, `?` bindings); never `$queryRawUnsafe`/string concatenation with input.
- Dynamic `ORDER BY`/column names from input → allowlist.
- Don't return ORM entities directly from APIs (leaks hidden fields) — select or map to a DTO.
- Soft-delete conventions: every query respects the project's filter (scopes, middleware) — check before writing raw queries.
- Money: `DECIMAL`/integer minor units, never float. Time: store UTC (`timestamptz`), convert at the edge.
- Connection handling: reuse the project's client singleton (serverless needs a pooled/edge-compatible driver); never create a client per request.

## Checklist (per query / migration)

- [ ] No query inside a loop; relations loaded in one round-trip (D1)
- [ ] Limit + pagination; filters/sorts indexed (D2)
- [ ] Multi-write in a transaction; concurrency-safe updates (D3)
- [ ] New migration, staged if destructive, applied only locally (D4)
- [ ] Parameterized; no unsafe raw query (S4)
