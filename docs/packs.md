# Knowledge packs

A **knowledge pack** teaches fxmind a domain: the skills agents read, the binding principles Gate V checks every diff against, and the routing that says which of them apply to which change. fxmind ships two packs (`fivem` and `web`); anyone can write another and publish it in their own repository.

A pack holds **only text**: `pack.json` and Markdown files (`.md`, `.mdc`). Installing one copies files; nothing in a pack is ever executed.

## Layout

```
my-pack/
├── pack.json                     # the manifest
├── skills/                       # one folder per skill
│   └── <skill-name>/
│       ├── SKILL.md              # required: front matter (name, description) + body
│       └── *.md                  # optional references the skill points to
└── templates/                    # files copied into the project's .fxmind/
    ├── <domain>-principles.md    # binding rules (cite them with IDs)
    └── domain-routing.md         # which skills and rules apply to which change
```

In a project, the pack's skills land in `.fxmind/skills/` and each template at the `dest` its manifest gives (usually `.fxmind/policy/`). When several packs ship the same file, such as `policy/domain-routing.md`, their contents are joined.

## The manifest: `pack.json`

| Field | Required | What it is |
|-------|----------|------------|
| `id` | yes | Lowercase letters, digits and hyphens. Must not be `fivem` or `web`. |
| `label` | yes | The name shown to people. |
| `description` | yes | One line: what the pack covers. |
| `skills` | yes | `{ "localPath": "skills" }` for skills inside the pack, or `{ "repo": "<git url>", "cacheName": "<name>" }` for skills in a repository of their own. |
| `defaultSkills` | yes | Skill folder names installed by default. With `localPath`, each needs `<localPath>/<name>/SKILL.md`. |
| `templateFiles` | no | `[{ "src": "<file in templates/>", "dest": "<path under .fxmind/>" }]`. |
| `detect` | no | `{ "files": ["<file name>"] }`: `fxmind -y` picks the pack when one of these is in the project. |
| `review` | no | What the independent reviewer reads at Gate V, paths relative to `.fxmind/`: `policy` (always first), `always`, and `rules` (`{ "match": "<regex on file paths>", "files": [...] }` or `{ "ui": true, "files": [...] }`). An entry is a path or `{ "file", "max" }` (characters). |
| `correctionTargets` | no | Where human corrections of agent mistakes are filed, by category (`{ "default": "<skill>/<file>.md", ... }`). |
| `createHint` | no | One line shown after install, e.g. how to start with `/fxmind create`. |

`packs/web/pack.json` in the fxmind repository is a complete real example.

## A complete minimal pack

This pack is in the fxmind repository at [`examples/packs/hello`](../examples/packs/hello).

`pack.json`:

```json
{
  "id": "hello",
  "label": "Hello",
  "description": "A minimal fxmind knowledge pack: one skill, one binding policy and its routing.",
  "skills": { "localPath": "skills" },
  "defaultSkills": ["hello-basics"],
  "detect": { "files": ["hello.config"] },
  "templateFiles": [
    { "src": "hello-principles.md", "dest": "policy/hello-principles.md" },
    { "src": "domain-routing.md", "dest": "policy/domain-routing.md" }
  ],
  "review": {
    "policy": ["policy/hello-principles.md"],
    "always": [{ "file": "skills/hello-basics/SKILL.md", "max": 1600 }]
  }
}
```

`skills/hello-basics/SKILL.md`:

```markdown
---
name: hello-basics
description: How this team writes greeting messages in the Hello app. Use when the user mentions greetings, welcome messages or the hello module.
---

# Hello basics

- Greetings live in `src/hello/messages.ts`; add new ones there, never inline in components.
- Every greeting has an English and a Brazilian Portuguese version.
- Keep a greeting under 80 characters.
```

`templates/hello-principles.md`:

```markdown
# Hello principles

Binding for every change in a project with the hello pack. Gate V checks the diff against them.

- **H1 — One source of greetings.** Greeting text lives only in `src/hello/messages.ts`.
- **H2 — Both languages.** A greeting added in one language is added in the other in the same change.
```

`templates/domain-routing.md`:

```markdown
# Domain routing — Hello

- Hello: `.fxmind/policy/hello-principles.md` is binding for every change; then `hello-basics/SKILL.md` for greetings.
```

## Writing good packs

- A skill's `description` decides when agents load it: say what it covers and the words that should trigger it.
- Principles are rules a reviewer can check against a diff. Give each an ID (`H1`, `H2`) so tasks and reviews can cite it.
- Keep each file short; the reviewer reads them under a character budget (`max`).
- Only facts about the domain belong in a pack. Project-specific facts belong in the project's memory (`/fxmind learn`).

## Publishing

Push the pack to any git repository: GitHub, GitLab, or your own server. The pack can be the whole repository or a folder in it, so one repository can hold several packs. Tag releases (`v1.0.0`) so people can install a fixed version.

## Installing

```bash
fxmind pack add <owner>/<repo>
```

```bash
fxmind pack add https://gitlab.com/my-org/fxmind-packs.git --path laravel --ref v1.0.0
```

```bash
fxmind pack add ./my-pack
```

- The source is `owner/repo` (GitHub), any git URL, or a local folder.
- `--ref <branch|tag>` clones that branch or tag; `--path <folder>` takes the pack from a folder of the repository.
- The pack is installed in `~/.fxmind/packs/<id>/` and the command prints that path.
- It is checked first. A missing field, a template that does not exist, a symbolic link, or any file other than `pack.json`, `.md` and `.mdc` rejects the whole pack, with the list of every problem found.
- When a pack with the same `id` is already installed, the command asks before overwriting it; without a yes nothing changes. Outside an interactive terminal it refuses unless `--force` is given.

Then use it in a project, like the packs fxmind ships:

```bash
fxmind --pack hello -y
```

`fxmind pack list` shows every pack and where the external ones came from; `fxmind pack remove <id>` removes one (it asks first). Inside an agent, `/fxmind pack add <source>` runs the same command.
