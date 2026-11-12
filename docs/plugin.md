# FXMIND Agent Plugin

This repository packages the existing FXMIND skill and MCP for the portable [Agent Plugins 1.0](https://agent-plugins.org/) format (Codex/Cursor), plus Claude Code compatibility. It does not replace the FXMIND engine or installer.

## Included

- `plugin.json` and `mcp.json` — portable manifest and MCP.
- `skills/fxmind/SKILL.md` — same contract as `templates/skills/fxmind/SKILL.md`.
- `skills/fxmind-setup/SKILL.md` — setup and verification.
- `.claude-plugin/plugin.json` and `.mcp.json` — Claude Code adapter.
- `.cursor-plugin/plugin.json` — Cursor adapter with `${CURSOR_PLUGIN_ROOT}` support (Cursor does not currently expand portable `${PLUGIN_ROOT}`).
- `scripts/plugin-mcp.js` — launcher that refuses to run in the plugin folder.

## Installation (marketplace)

This repository is also a plugin marketplace. `plugins/fxmind/` is the skills-only bundle it serves (no MCP, so it never duplicates the project-level server); its skills must stay identical to `skills/` (checked by `scripts/plugin.test.js`).

- Claude Code: `/plugin install fxmind --marketplace proelias7/fxmind`
- Codex: `codex plugin marketplace add proelias7/fxmind`, then `codex plugin add fxmind@fxmind`

Then ask the agent to "set up fxmind in this project": the `fxmind-setup` skill runs the project installer.

Knowledge packs (domain skills and rules) can come from any repository: `fxmind pack add <owner/repo>`, or `/fxmind pack add` inside an agent. See [Knowledge packs](packs.md) to write and publish one.

## Installation (CLI)

Install Node.js >=20.9 and the FXMIND runtime with:

```sh
npm install -g github:proelias7/fxmind
```

Then use the client you want (repeat for multiple clients):

```sh
fxmind plugin cursor
fxmind plugin claude
fxmind plugin codex
```

- **Cursor:** copies the Agent Plugin manifest + two skills to `~/.cursor/plugins/local/fxmind`. Restart Cursor or use **Developer: Reload Window**; verify in **Customize > Plugins**.
- **Claude Code:** creates a local FXMIND marketplace under `~/.fxmind/plugin-cli/marketplace` and installs the skills-only plugin via `claude plugin marketplace` / `claude plugin install`, with user scope. Requires `claude` on PATH.
- **Codex:** registers the same local marketplace with `codex plugin marketplace add` and installs `fxmind@fxmind-local` using `codex plugin add`. Requires `codex` on PATH. Re-running is idempotent at the installed version; if the installed version differs, the CLI explicitly instructs how to reinstall (to avoid silent deletion).

All three installs intentionally bundle **skills only**, not another MCP server or global gates. They can run without an initialized project. To enable shared memory and MCP in an individual project, run `fxmind --agent cursor,claude,codex -y` from that project (or `fxmind --update -y` for an existing installation). This preserves project memory and hooks. Keep the existing **single project-level MCP registration**.

The full repository also retains the portable plugin MCP for controlled/manual installations. If using that alternative, set `FXMIND_TARGET` explicitly and disable the duplicate project-level MCP; do not commit machine-specific paths. For any client, restart the agent and verify the expected tools with a read-only `fxmind_list_memories` or `fxmind_query` call. Tool counts depend on packs and configuration.

### Explicit project selection

Portable plugin managers launch stdio servers from the plugin directory, which may not be the user's workspace. To avoid putting memory or gate state in the wrong location, the bundled launcher fails closed when it cannot resolve an initialized target project. For hosts without per-project environment injection, use FXMIND's existing project-level MCP configuration.

### Runtime and hooks

A plugin installed from a bare Git checkout does not include `node_modules`. The launcher uses dependencies from `npm ci` in the checkout or a global FXMIND runtime, and reports missing dependencies without downloading anything during the MCP handshake.

Cursor hooks and gates remain project-scoped through `fxmind` CLI. Global hooks could activate task gates for unrelated questions; they are intentionally not bundled by this portable plugin.

## Claude Code mod

In Claude Code the bundle also loads a hooks module (`plugins/fxmind/hooks/register.tsx`) with three parts:

- **Gate V asks first** (setting `gateV`, default `ask`): when a task reaches Gate V and needs the independent review, the band above the prompt asks whether to run it and with which installed agent (Codex, Claude Code, OpenCode…), or to skip it. The MCP server waits on that answer only while the mod's marker (`.fxmind/state/gate-v-ask.json`) is fresh and the caller is Claude Code; otherwise, or with `gateV: auto`, the review runs at once as before. A skip is recorded as the person's and still goes stale if the code changes. See `scripts/lib/gate-v-ask.js`.
- **No footer line under the prompt.** The mod once wrote one (memories, stale count, task gates); that now lives in the side panel only. The bar below is the only panel the mod draws above the prompt.
- **Prompt refiner** (`refine.tsx`, `/fxmind-refine`): a demand to build something is held back before it reaches the agent. The refiner's model reads it, asks its doubts above the prompt (answer there or in the prompt box), writes a prompt from the answers (goal, context, requirements, scope, done-when), clears the chat and sends that prompt in the demand's place. Questions, follow-ups and commands pass untouched. `/fxmind-refine <demand>` refines one on request; `/fxmind-refine auto | command | off` sets when it runs. Settings: `refine`, `refineWith` (`haiku` by default, `sonnet`, `opus` or `session`, the chat's model; it reads the demand and writes the prompt), `refineClear`, `refineSend` (send, or fill the prompt box to review first).
- **Effort bar** (`effort.tsx`, `/fxmind-effort`): the reasoning effort picked per prompt by a judge (Haiku, or Jev with the key in `~/.fxmind/jev.env`), the prompt-cache countdown, context use, Compact and Handoff, limit alerts, a progress bar, an agent panel (`/fxmind-effort agents`), settings and stats. Ported from [effortless](https://github.com/HeyCubit/effortless) (MIT, see `plugins/fxmind/LICENSE-effortless`); disable the effortless plugin itself when this one is on, or both judge every prompt. Settings (the gear) opens on cards by name only; its `fxmind` card holds the prompt refiner's options and buttons for `/fxmind init`, `memory health` and `learn`. Settings → Customize picks the language (`language`: `en` by default, or `pt-BR`; the words live in `i18n.ts`) and the theme (`theme`: `mint`, the site's green on its dark ink, by default).

Check it with `claude plugin validate plugins/fxmind` and `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude plugin test plugins/fxmind` (tests sit beside the code as `hooks/*.test.ts`), and try it with `claude --plugin-dir plugins/fxmind`.

## Development

Run `npm ci` then `npm test`. `scripts/plugin.test.js` validates manifests, skill sync, target selection and launcher behavior. Smoke-test a fresh session in Codex, Cursor and Claude before public marketplace publication. Public local-stdio plugin submission can require provider approval.
