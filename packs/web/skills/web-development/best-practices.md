# Web best practices — index

Table of contents only. Open the file for the topic you need; principle IDs are in `.fxmind/policy/web-principles.md`.

| File | Sections |
|------|----------|
| [security.md](security.md) | §1 validation · §2 authorization · §3 secrets/PII · §4 injection · §5 XSS/redirects/SSRF · §6 sessions/CSRF/CORS/headers · §7 abuse limits · §8 dependencies |
| [architecture.md](architecture.md) | §1 layers · §2 existing structure · §3 state ownership · §4 contracts · §5 dependencies |
| [api.md](api.md) | §1 resources/methods · §2 status codes · §3 errors · §4 pagination · §5 responses · §6 versioning · §7 webhooks/idempotency |
| [communication.md](communication.md) | §1 where to fetch · §2 client cache · §3 mutations · §4 races/cancellation · §5 realtime |
| [performance.md](performance.md) | §1 measure · §2 server hot paths · §3 rendering · §4 bundle · §5 caching |
| [style.md](style.md) | §1 minimal code · §2 naming · §3 flow · §4 errors · §5 types · §6 clean diff · §7 anti-patterns |
| [testing.md](testing.md) | §1 what to test · §2 determinism · §3 running · §4 never weaken · §5 fixtures |
| [quality-gates.md](quality-gates.md) | Gate A QUALITY · implement checks · self-review loop · Gate V line |
| [../web-frontend/SKILL.md](../web-frontend/SKILL.md) | components · state · forms · UI states · styling |
| [../web-frontend/accessibility.md](../web-frontend/accessibility.md) | semantics · names · keyboard/focus · forms · contrast/motion · testing |
| [../web-backend/SKILL.md](../web-backend/SKILL.md) | handlers · services · auth · jobs · config/logging |
| [../web-backend/database.md](../web-backend/database.md) | N+1 · bounded reads/indexes · transactions · migrations · ORM pitfalls |

## Learned rules

Corrections promoted from `.fxmind/corrections/` are folded into the section they refine as one `**Rule (ID):**` line — never appended here as a new section.
