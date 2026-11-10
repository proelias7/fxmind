# Security — web

Principles S1–S7 from `.fxmind/policy/web-principles.md`. Reference: OWASP Cheat Sheet Series (https://cheatsheetseries.owasp.org).

## §1 Validate at the boundary (S1)

- Parse every untrusted input **once** at the entry point with the project's schema library (zod, valibot, yup, class-validator, pydantic, Laravel FormRequest…). Downstream code receives typed, validated data.
- Validate all sources: body, query, route params, headers you use, cookies, form data, webhook payloads, queue messages, `postMessage`, files.
- On writes, use a strict schema (reject or strip unknown keys) so clients cannot set `role`, `ownerId`, `price`, `isAdmin` (mass assignment).
- Bound everything: string length, array length, number range, enum values, page size.
- Client validation is for UX; the server re-validates.

```ts
// ✅ route handler
const Body = z.object({ title: z.string().trim().min(1).max(120), tags: z.array(z.string().max(30)).max(10) }).strict();
const input = Body.safeParse(await req.json());
if (!input.success) return Response.json({ error: "invalid_input", issues: input.error.flatten() }, { status: 400 });
```

## §2 Authorization on every server entry point (S2)

- Authentication answers *who*; authorization answers *may this user do this to this resource*. Check both, on the server, in every route, server action, resolver and user-triggered job.
- Scope queries by the caller: `where: { id, ownerId: user.id }` (or tenant id), never `findUnique({ id })` then trust it (IDOR).
- Default deny: new endpoints start protected; public ones are explicit.
- Reuse the project's guard/middleware/helper (`requireUser`, `@UseGuards`, policies) instead of re-implementing checks.
- Next.js server actions and API routes are public HTTP endpoints — check auth inside each one, not only in middleware.
- Return 404 instead of 403 when revealing existence would leak information.

## §3 Secrets and personal data (S3)

- Secrets only from server-side env or a secret manager. Anything with `NEXT_PUBLIC_`, `VITE_`, `NUXT_PUBLIC_`, `PUBLIC_` ends up in the browser.
- Never commit `.env`; keep `.env.example` with names only. Never print env values in logs, errors or chat.
- Logs carry ids and event names, not tokens, passwords, full card numbers, documents or full request bodies.
- Error responses to clients never include stack traces, SQL or internal paths.
- Hash passwords with the framework/library standard (argon2/bcrypt via the existing auth lib); never roll your own crypto.

## §4 Injection (S4)

- SQL: ORM query builders or parameterized queries only. Raw SQL uses placeholders (`$1`, `?`, tagged `sql\`` templates that parameterize). Never concatenate input into SQL, `ORDER BY` or identifiers — allowlist column names.
- Shell: avoid; if required use `execFile`/`spawn` with an argument array, never `exec` with interpolated strings.
- No `eval`, `new Function`, `vm` on input; no dynamic `require`/`import()` from input.
- NoSQL: don't pass raw objects from the request into queries (`{ $gt: "" }` operator injection) — validate types first.
- Path traversal: resolve user-provided paths and confirm they stay inside the allowed directory.

## §5 XSS, redirects and SSRF (S4)

- Render user content as text (React/Vue escape by default). `dangerouslySetInnerHTML`, `v-html`, `innerHTML`, `insertAdjacentHTML` only with a sanitizer (DOMPurify) and a reason.
- Never build `href`/`src` from input without allowing only `https:`/relative URLs (`javascript:` links).
- Redirects (`?next=`) go only to relative paths or an allowlist of hosts.
- Server-side fetch of a user-provided URL (webhooks, previews, imports) → allowlist hosts or block private/link-local ranges; set timeouts and size limits.

## §6 Sessions, cookies, CSRF, CORS, headers (S5)

- Session cookies: `HttpOnly`, `Secure`, `SameSite=Lax` (or `Strict`), sensible expiry; rotate session id on login.
- Cookie-authenticated mutations need CSRF protection (framework token, `SameSite` + origin check). GET never mutates.
- CORS: explicit origin allowlist; never `Access-Control-Allow-Origin: *` together with credentials.
- Keep existing security headers (CSP, HSTS, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, frame protections); don't weaken CSP to make a script work — add a nonce/hash.
- Tokens in `localStorage` are readable by any XSS; prefer `HttpOnly` cookies when the project allows.

## §7 Abuse limits (S6)

- Rate limit login, signup, password reset, OTP, search, uploads, contact forms, AI/LLM calls and anything that sends email/SMS or costs money. Use the project's limiter (middleware, gateway, Redis).
- Limit request body size and upload size; check file type by content/MIME, not only extension; store uploads outside the web root or in object storage with private ACL; generate filenames server-side.
- Generic auth errors ("invalid credentials") — don't reveal whether an account exists.
- Webhooks: verify signatures with the provider SDK and the raw body; reject replays (timestamp tolerance, idempotency key).

## §8 Dependencies (S7)

- Before adding a package: does the platform (`fetch`, `URL`, `crypto.randomUUID`, `Intl`, `structuredClone`, CSS features) or an installed package already do it?
- A needed package: actively maintained, reasonable size, license compatible, installed with the project's package manager so the lockfile updates.
- Don't add a second library for the same job (two date libs, two HTTP clients, two state managers).
- Treat `postinstall` scripts and unknown packages with suspicion; check the exact package name (typosquatting).

## Checklist (per endpoint / action)

- [ ] Input schema validated at entry (S1)
- [ ] Authenticated + authorized for this resource (S2)
- [ ] No secret/PII in response, logs or client code (S3)
- [ ] No string-built query/HTML/shell from input (S4)
- [ ] Cookie/CSRF/CORS rules unchanged or correct (S5)
- [ ] Rate/size limit if public or expensive (S6)
