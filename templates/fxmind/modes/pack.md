# fxmind — Mode: Pack

Manage knowledge packs from other repositories with the `fxmind` CLI. The CLI fetches, checks and copies; this mode only runs it and relays the result.

Parse `$ARGUMENTS` after `pack`:

| Input | Run |
|-------|-----|
| `add <source> [--ref <ref>] [--path <folder>]` | `fxmind pack add <source> ...` |
| `remove <id>` | `fxmind pack remove <id>` |
| `list` or empty | `fxmind pack list` |
| `new <id>` | `fxmind pack new <id>` (a pack inside the fxmind repository itself) |

`<source>` is `owner/repo` (GitHub), a git URL, or a local folder.

### Rules

- Run the command as given. Never add `--force` on your own.
- When the CLI says the pack is already installed, it changes nothing: ask the user in chat whether to overwrite (or remove), and only after an explicit yes run the same command again with `--force`.
- When the CLI rejects a pack, show its list of problems as it printed them; do not edit the pack or work around the check.
- After `add`, tell the user the path the CLI printed and how to use the pack in this project: `fxmind --pack <id> -y` (or add it with `--packs <ids>` next to the packs already installed, listed in `.fxmind/packs.json`). Do not run it unless asked.
- The format of a pack is in the fxmind docs: `docs/packs.md`.

Reply in the user's language, short.
