# fxmind — Mode: Audit

**Read-only analysis.** Do **not** edit code unless the user explicitly asks to implement fixes after reviewing the plan.

> **Output path (mandatory):** write the report to **`.fxmind/audits/<unit-name>.md`** only.
> **Forbidden:** `.fxmind/audit-<name>.md` or any `audit-*.md` in the `.fxmind/` root — use the `audits/` folder.

Audit the target unit(s) (FiveM resource, web feature/module/service — see **Unit of work** in `.fxmind/policy/domain-routing.md`) for **security**, **performance**, and **patterns**. Deliver a structured report + prioritized correction plan.

Audit diagnoses; it does not fix. After the report: a few local findings → implement Phase 1 via Task mode; widespread problems (most of the unit needs rewriting) → **`/fxmind refactor <scope>`**, which reuses this report as input. Judge findings against the installed pack principles under `.fxmind/policy/` and cite the principle ID in each finding.

## Full procedure is external

The complete audit matrix of the installed pack (passes, severity/phase, report sections, rules) lives in **`.fxmind/audits/procedure.md`** — **read it now** before continuing. It is intentionally kept out of the command body to save context on non-audit invocations.

If `.fxmind/audits/procedure.md` is missing, run `fxmind --update -y` (or `npx --yes github:proelias7/fxmind --update -y`) to restore it, then retry. Do not improvise the matrix from memory.

## Audit scope

- `audit` alone → unit/folder from user `@` mention, open files, or ask which one to audit
- `audit <path>` → audit that path only (file or folder) if it exists

## Quick reference (every pack)

- Read the **whole unit scope** defined by the pack — never audit a single file unless explicitly scoped.
- Every finding cites `file:line` + the exact symbol — read the line before citing.
- Run every pass of the procedure; report each matrix row as **Found** or **N/A**; never skip.
- Inventory **every** externally callable entry point (events/callbacks, routes, server actions, webhooks, jobs) and check authorization + input validation for each.
- Severity→Phase: Critical→1, High→2, Medium→3, Low→4. Never downgrade because the code is "small".
- Summary counts must equal findings rows; Files reviewed = files actually in scope.
- Do not auto-fix; ask before implementing Phase 1. Recommend `refactor` instead when Critical/High findings span most files.
- Pack-specific non-negotiables are in `.fxmind/audits/procedure.md`.
