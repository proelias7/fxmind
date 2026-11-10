# fxmind — Mode: Create (new resource / feature / module)

Use when the user asks for a new resource, feature or system ("crie uma resource de ...", "crie a página/módulo/API de ...", `/fxmind create <description>`). Design first, build after approval. The design is the contract the build is verified against.

## 1. Discover (read-only)

- Read `.fxmind/policy/domain-routing.md`: its **Unit of work and stack detection** section says what a unit is (FiveM resource, web feature/module/route) and where to detect the stack and available dependencies. Confirm in the files it names and in `.fxmind/reference.md`.
- Use preloaded memories or `fxmind_query` once for the domain; find the closest existing unit and copy its conventions, not its defects.
- Read the installed pack principles under `.fxmind/policy/` (binding) and only the skill references the design touches. Verify APIs from primary docs.

## 2. Design

Write `.fxmind/designs/<name>.md` from `.fxmind/templates/resource-design.md` (`kind: create`, `status: draft`). Fill every table the pack template defines; one line per decision. Core questions for every pack:

- **State ownership** — for each piece of data: owner, storage, how other parts see it.
- **Contract** — every entry point (event/callback, route/endpoint, component prop/emit, job, command) with caller, payload shape and size, frequency, validation and authorization.
- **Data access** — when each table/store is read/written; hot paths use cache/batching.
- **Background work** — each loop/timer/job justified; replace with event-driven code when possible.
- **Files** — the minimum set.
- **Principles check** — every pack principle ID answered.
- **Build slices** — small runnable steps, each with its verification.

Surface real choices as open questions instead of guessing (e.g. persistence, who may use it, UI or command). Keep the design compact: tables, no prose.

## 3. Approval checkpoint

Reply short: link to the design, the 3–5 key decisions, open questions. Wait for approval unless the user already said to build without review. Apply requested changes to the design, set `status: approved`.

## 4. Build

Run Task mode (`.fxmind/modes/task.md`) per slice with the design as Done: Gate A cites the design path; Gate B lists the slice files. Implement exactly the approved contract; any deviation updates the design first and is reported.

## 5. Verify and close

Gate V `review` compares the diff with the design: every contract entry exists as designed (callers, payload, validation, limits), nothing extra was added, principle IDs checked. Runtime: follow **Runtime verification** in `.fxmind/policy/domain-routing.md`, then exercise the Done flows. Set `status: built`; `/fxmind learn <name>` saves the verified memory.
