# fxmind — Mode: Reference

Generate or update **`.fxmind/reference.md`** — the project map with paths, flows, and anti-bug notes for all agents (Cursor, opencode, Claude, Gemini).

Keep it **lean**: detailed flows for recurring topics belong in `.fxmind/memory/<topic>.md` via `/fxmind learn <topic>` — do not paste full craft/item recipes here. Memory files use compact technical English (`lang: en-compact`); only link to them from this reference.

### Step 1 — Discover the project

Search and read (do not guess paths):

Follow **Reference discovery** in `.fxmind/policy/domain-routing.md` (installed pack) for what to look for. In every stack cover:

1. **Stack / framework** — manifest files and versions actually used.
2. **Core config** — domain configuration, auth/permissions, environment variables (names only, never values).
3. **Custom modules** — main features and where they live.
4. **Integrations** — databases, caches, queues, external APIs, webhooks.
5. **UI** — source folder, build command and output path.
6. **Security patterns** — validation, authorization, rate limits as implemented here.
7. **Git** — submodules, monorepo layout.

Use semantic search, grep, and file reads. Every path in the output must exist in the repo.

### Step 2 — Read existing context

- If `.fxmind/reference.md` exists → read it and **merge/update** (preserve valid sections, replace outdated paths).
- Read `.fxmind/templates/reference.mdc` for section structure (installed by the pack).
- Read `.fxmind/templates/reference.example.mdc` (when the pack ships one) for format/depth only (fictional sample — do not copy its paths).

### Step 3 — Write `.fxmind/reference.md`

Use this frontmatter:

```yaml
---
description: <ProjectName> — referência rápida (<stack/framework>)
---
```

Required sections (adapt titles to what exists in **this** project):

1. **Manutenção desta referência** — update when new patterns appear.
2. **Stack / auth / permissões** — how auth works in this codebase.
3. **Domínio principal** — main entities, where they are registered/configured, naming conventions.
4. **Configuração e integrações externas** — config files, webhooks, external services.
5. **Sistemas custom** — one line per major feature pointing to memory or key config path (e.g. "Checkout → `/fxmind learn checkout`").
6. **Memórias por tópico** — table linking topics to `.fxmind/memory/*.md` (filled by `/fxmind learn`).
7. **Integrações** — the libraries/patterns from the pack's reference discovery list **as used here**.
8. **UI** — source folder + build command/path if applicable.
9. **Git / submodules** — if relevant.
10. **Skills** — `.fxmind/skills/` (pack skills); agent folder has only `fxmind` skill.

Write in **Portuguese** if the codebase/comments are PT-BR; otherwise match project language.

### Step 4 — Confirm

After writing the file, reply with: stack detected, sections documented, paths that need manual review (if any), file created `.fxmind/reference.md`.

### Rules

- **Never invent** file paths, events, or APIs — verify with search.
- **Do not** paste generic tutorials — only project-specific findings.
- Prefer **actionable** notes: where to edit, checklists, common bugs.
