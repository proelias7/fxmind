# Domain routing — FiveM

- FiveM: `.fxmind/policy/fivem-principles.md` is binding for every change (scope/payload/chunks/statebags/anti-flood, no DB in hot paths, minimal code); then `fivem-development/quality-gates.md` rows for the touched artifacts and relevant references.
- Framework calls: the matching vRP, QBCore, Qbox or ESX skill.
- NUI/React: `fivem-react-nui/SKILL.md`.

FiveM dev tools: status before ensure/restart/tail; use tools yourself when available. Missing runtime blocks runtime verification. NUI wire/dump must be unwired before final validation; CEF visuals require in-game evidence. Respect real DB mutation boundaries and never invent approval.

## Unit of work and stack detection (FiveM)

- Unit = a **resource**; its scope is the full `fxmanifest.lua` file list (audit, refactor, create design).
- Framework: `fxmanifest.lua` dependencies — `vrp` → vRP Creative Network, `qbx_core` → Qbox, `qb-core` → QBCore, `es_extended` → ESX (`fivem-development/framework-detection.md` for bridges). Dependencies to look for: oxmysql, target, ox_lib, cerberus, cacheaside, NUI stack.
- Contract inventory (refactor/design): every net event, callback/tunnel function, export, command, DB table/query, statebag key, NUI message/callback and config key — with `file:line`.
- Design tables (create/refactor): state ownership (statebag vs on-demand pull), network contract with recipients (N1), payload size (N2/N3), frequency (N4), rate limit/validation (N6); DB reads/writes with cache/write-behind (D1); each loop with its sleep (T1); minimum files (C1/C2).
- Refactor slice order: data layer (cache, no DB in hot paths) → network (scope, payload, chunks, statebags) → threads (sleep, handlers) → code cleanup.

## Help routing (FiveM)

- Native function → https://docs.fivem.net/natives/ (never invent natives).
- vRP → `vrp-framework`; QBCore → `qbcore-framework` / https://docs.qbcore.org/; Qbox → `qbox-framework` / https://docs.qbox.re/; ESX → `esx-framework` / https://docs.esx-framework.org/; ox_lib → https://overextended.dev/ox_lib.
- Assets (prop, vehicle, ped) → `fivem-development/asset-discovery.md` + PlebMasters.
- NUI/React → `fivem-react-nui`; patterns → `fivem-development/SKILL.md` router.

## Reference discovery (FiveM)

Framework (`fxmanifest.lua` deps, `resources/[System]/`), core config (items, groups/jobs, economy, shops), custom resource folders (`[Novos]`, `[Exclusive]`, `[Scripts]`), integrations (cacheaside, cerberus `SendFullSync`/`SendDeltaSync`/`SafeEvent`/`SetCooldown`, oxmysql, ox_lib, webhooks), NUI source + build path, security patterns, git submodules.

## Runtime verification (FiveM)

Resource touched → `fxmind_fivem_status` first; when available → ensure/restart + `fxmind_fivem_console_tail` (no script errors), then the Done flows in-game. Unavailable → UNVERIFIABLE; ask the user to run ensure.
