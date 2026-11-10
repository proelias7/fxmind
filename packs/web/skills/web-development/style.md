# Style — readable, minimal web code

Principles C1–C5 from `.fxmind/policy/web-principles.md`. The project's lint/format config (ESLint, Prettier, Biome, Ruff, PHP-CS-Fixer) is the authority on formatting — run it, don't hand-format.

## §1 Minimal code (C1)

- Before writing: does it need to exist? Is there an existing helper/component/hook? A platform or installed-library feature? Only then write new code.
- A new function/component must be reused or mark a real boundary (route handler, validation, data access, a UI unit with its own state). No single-use wrappers, pass-through hooks, "manager" classes or factories with one product.
- No config/options for values nobody changes; no "for later" parameters.
- Delete code made dead by your change (unused imports, props, exports, styles).

## §2 Naming

- Domain names over technical ones: `cancelOrder`, `isOverdue`, `invoiceTotal` — not `handleData`, `processItem`, `flag`, `temp`.
- Booleans read as questions (`isLoading`, `hasAccess`, `canEdit`); functions are verbs; components are nouns.
- Match the casing/file naming already used (camelCase vs kebab-case files, `PascalCase.tsx` components).

## §3 Flow and size (C2)

- Early returns / guard clauses instead of nested `if`/`else` pyramids.
- One job per function; extract when a block has its own name and is reused or obscures the main flow.
- No clever one-liners that need decoding, no nested ternaries, no metaprogramming for simple data.
- Keep components focused: data fetching, state and presentation can live together in small components; split when a part is reused or the file mixes unrelated concerns.
- Prefer immutable updates and plain data; avoid hidden mutation of arguments.

## §4 Errors (C3)

- Never `catch {}` or `catch (e) { console.log(e) }` and continue as success.
- `await` every promise or handle it (`void` with a `.catch`, fire-and-forget only for truly optional work with error logging).
- Catch at the level that can do something (retry, fallback, map to HTTP/UI); let unexpected errors reach the framework's error handler/boundary.
- Throw `Error` objects (or the project's error classes), never strings; include context without secrets.
- UI: error boundaries / error routes for unexpected failures; inline messages for expected ones.

## §5 Types (C5)

- No `any`; use `unknown` + a guard/schema at boundaries.
- No `as unknown as T`, non-null `!` or `@ts-ignore`/`@ts-expect-error`/`eslint-disable` to silence a real error — fix the cause or narrow with a check. `@ts-expect-error` only with a reason and a test proving the case.
- Infer types from schemas (`z.infer`) and from the ORM/codegen instead of duplicating them.
- Model states as discriminated unions (`{ status: "loading" } | { status: "error"; error } | { status: "ok"; data }`) instead of several booleans.
- Python: type hints + the project's checker; PHP: typed properties/returns.

## §6 Clean diff (C4)

- No `console.log`/`print`/`dd()`/`debugger` left behind (use the project logger for intentional logs).
- No commented-out code, TODOs without an issue, unrelated reformatting, drive-by renames or import reordering outside the touched lines.
- Comments explain **why** (a constraint, a workaround with link), never restate what the code says.

## §7 Anti-patterns checklist

- [ ] `useEffect` to sync derived state or to fetch when the framework/library handles it
- [ ] Prop drilling through 4+ levels instead of composition/context
- [ ] Magic numbers/strings repeated instead of a named constant (once is fine)
- [ ] Copy-pasted logic in 3+ places instead of one helper
- [ ] Boolean parameters that switch behavior (`render(true, false)`) instead of separate functions/options object
- [ ] Mixed concerns: fetch + validation + business rule + rendering in one function
