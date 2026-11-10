# Testing — web

Principles T1–T2 from `.fxmind/policy/web-principles.md`. Use the runner and conventions already in the project (Vitest, Jest, Playwright, Cypress, Testing Library, pytest, PHPUnit/Pest).

## §1 What to test (T1)

- **Bug fix** → first a test that fails for the reported reason, then the fix. The test name describes the behavior, not the ticket.
- **New behavior** → the smallest test at the lowest useful level:

| Level | Good for | Tooling |
|-------|----------|---------|
| Unit | pure logic, validation schemas, formatting, reducers, permission rules | Vitest/Jest/pytest |
| Integration | route handler + validation + DB, service + repository, component + its hooks | test DB/transactions, supertest/`fetch` against the app, Testing Library |
| E2E | critical user journeys (login, checkout, signup) only | Playwright/Cypress |

- Test the **contract** (inputs → outputs, rendered text/roles, HTTP status + body), not implementation details (private functions, internal state, CSS classes).
- Always cover the failure path that matters: invalid input → 400, unauthorized → 401/403, not found, empty list.
- Authorization deserves its own tests: user A cannot read/modify user B's resource.

## §2 Deterministic tests (T2)

- No real network: mock at the HTTP boundary (MSW, nock) or inject fakes; never hit third-party APIs.
- Control time and randomness (fake timers, fixed clock, seeded ids).
- Each test sets up its own data and cleans up (transactions rolled back, fresh fixtures); no order dependence.
- Await UI changes (`findBy…`, `waitFor`, Playwright auto-wait) — no fixed `sleep`.
- Query UI by role/label/text (`getByRole("button", { name: "Salvar" })`) — that also checks accessibility.

## §3 Running

- Run the focused test file first, then the related suite; record the command and the result in the Gate V check.
- Use the project scripts (`pnpm test -- path`, `npm run test:unit`), not a global binary with different config.
- Typecheck and lint are checks too — run them when the project has them.

## §4 Never weaken tests

- Don't delete, `.skip`, `.only`, loosen assertions, or update snapshots blindly to make CI green. If a test is wrong, explain why in the review and fix it to assert the intended behavior.
- Snapshot tests only for stable, small output; prefer explicit assertions.

## §5 Fixtures and data

- Builders/factories over giant shared fixtures; only the fields the test needs.
- No production data or real personal data in tests or fixtures.
- Test DB: separate database/schema; never point tests at a shared or production `DATABASE_URL`.
