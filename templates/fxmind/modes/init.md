# fxmind — Mode: Init

Initialize shared project knowledge by reading the main modules, mapping how they work, and saving source-grounded facts. This is a chat-agent workflow, not a terminal installer. Never change application source or run its code during initialization.

## 0. Configure before learning

First have the user run `fxmind init` in their own interactive terminal, in the project directory. It asks which knowledge packs, agents and skills to install, then whether to enable Jev. If enabled, the API key is entered with a hidden terminal prompt and saved in `~/.fxmind/jev.env`. Never ask for or accept that key in chat, tool arguments, transcripts or source files. Agents cannot answer these choices or supply the key for the user. If the host supports an interactive terminal handoff, open it; otherwise show the command and wait for the user to complete it. A non-interactive shell is not a substitute.

Once setup succeeds, have the user restart the client/MCP if it changed, then continue this workflow. If they confirm they already completed setup for this initialization, do not launch the wizard again. `fxmind jev` configures Jev separately at any time. Initialization can continue without Jev when the user declines it.

## 1. Discover the main modules

- Read existing `.fxmind/reference.md`, installed `.fxmind/policy/domain-routing.md` and `.fxmind/skills/_index.md` when present. Use preloaded memories or `fxmind_query` to avoid relearning existing facts.
- Inspect project manifests, entry points, route/resource registrations and dependencies to identify the main modules. Skip generated files, assets, dependency directories and unrelated packages.
- Prioritize the core domain, authentication/permissions, persistence and caches, integrations, and the main UI flows where applicable. Follow the project's actual structure; do not assume a framework or invent modules.
- If the user supplied a path/module after `init`, focus on that scope. Otherwise start with up to five main modules and list the remainder as pending; do not claim the entire project was learned.

## 2. Read and understand

For each selected module, read its entry points, relevant implementation and callers. Trace its primary flow and identify responsibilities, dependencies, permissions, data changes, configuration and important pitfalls. Confirm every claim in source; names or directory listings alone do not establish behavior. Load only the relevant domain skill references.

## 3. Learn verified facts

Follow `.fxmind/modes/learn.md` for each selected module:

- Query existing knowledge for that module before adding facts. Reuse valid facts and investigate stale claims instead of duplicating them.
- Save a few independent, useful facts about confirmed behavior, contracts, permission checks or pitfalls. Each fact needs its real project-relative `path` and an exact source substring as `evidence`.
- Use `fxmind_graph` with `updateHtml: false` and `addFact` (`topic`, `kind`, `text`, `path`, `evidence`; optional confirmed `symbols`/`events`). The tool validates evidence and persists the shared atomic memory. Do not write or replace the atoms JSON yourself.
- If MCP is disconnected but the CLI is available, the equivalent is `fxmind memory add --topic <topic> --text <fact> --path <path> --evidence <exact-source>`. Quote arguments for the actual shell. If neither is available, report learning as blocked; a reference document alone is not completed initialization.
- Preserve existing Markdown memories, user decisions and other agents' facts. Never save credentials, secrets or personal data.

## 4. Save the project map

Create or merge `.fxmind/reference.md`, preserving valid existing content. Use `.fxmind/templates/reference.mdc` and the installed pack's reference-discovery guidance when available. Keep the map lean:

- Detected stack and actual entry points.
- Main modules: responsibility, paths, dependencies and primary flow.
- Project conventions and verified security/data/integration rules.
- Memory topics for the modules that were learned.
- Coverage: modules inspected, modules pending, unavailable evidence and open questions.

Link to existing source files and memory topics; do not duplicate whole implementations or overwrite unrelated sections. Use the user's language.

## 5. Verify and report

Check the persistence result for each fact. Query a representative fact with MCP `fxmind_query` and confirm it retrieves the expected source. If only CLI writes were available, report saved facts separately from pending retrieval verification; resume that check when MCP reconnects. Report modules inspected, facts added/reused, the reference path, and any pending or blocked learning. Only claim complete initialization after the facts were actually saved and retrieval was checked. Re-running `init` updates this knowledge without deleting existing memories.
