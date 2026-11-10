# fxmind — Mode: Refactor (rewrite badly written code)

Use for large rewrites/optimizations of an existing unit (`/fxmind refactor <scope>`, "refaça/otimize a resource/módulo X"). Small, local fixes stay in Task mode. Audit only diagnoses; this mode turns findings into a behavior-preserving rewrite.

## 1. Scope and findings

- Scope is the unit defined in **Unit of work and stack detection** of `.fxmind/policy/domain-routing.md` (e.g. full `fxmanifest.lua` file list for FiveM; the feature/module folder and its entry points for web).
- If `.fxmind/audits/<name>.md` exists and is current, use its findings as input — do not re-audit. Otherwise record findings while inventorying (step 2); run a full audit only when the user asked for a report.
- Read the installed pack principles under `.fxmind/policy/` (binding) and the skill references for the areas being rewritten.

## 2. Current contract (the invariants)

Write `.fxmind/designs/<name>.md` from `.fxmind/templates/resource-design.md` (`kind: refactor`). Fill **Current contract** from the code using the pack's contract inventory list (domain-routing) — every public name other code depends on, with `file:line`. These names stay identical unless a change is approved.

## 3. Target design

Fill the design tables for the new version (state ownership, contract, data access, background work, files, principles check). Mark every intentional behavior change in the contract table as `changed: <why>`. Removing duplicated/unused code is expected but must not remove a contract entry silently.

## 4. Plan slices and approve

Split into slices that each leave the unit runnable, ordered by risk/benefit (the pack's slice order in domain-routing when present). Reply short with the design path, the slices, behavior changes and open questions. Wait for approval unless already authorized.

## 5. Execute

One Task (`.fxmind/modes/task.md`) per slice; Gate A cites the design and slice; record INVARIANTS as the contract rows the slice touches. Rewrite freely inside the slice — prefer deleting and rewriting a function over patching layers onto bad code — while keeping every contract name and payload shape the callers use.

## 6. Parity verification

Gate V per slice: every contract row touched is present (or approved-changed) — check names with `fxmind_search`; external callers of changed contracts are found and updated or listed. Runtime: follow **Runtime verification** in domain-routing and exercise the main flows. After the last slice, set `status: built`, update the audit report status if one exists, and `/fxmind learn <name>` saves the new structure.
