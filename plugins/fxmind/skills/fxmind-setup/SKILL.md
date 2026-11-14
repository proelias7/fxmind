---
name: fxmind-setup
description: Install, update or repair FXMIND in the user's current coding project (shared memory, knowledge packs, MCP tools). Use when the user asks to install, set up, enable, update or fix fxmind.
---

# Set up FXMIND

Use this skill only when the user asks to install, update or repair FXMIND.

1. Work in the user's project root (the workspace open in the agent). Never use the plugin directory as the project.
2. Check `node --version` is 20.9 or newer. If not, stop and tell the user to install Node.js from https://nodejs.org.
3. Pick the flag for the agent you are running in: `--claude`, `--codex`, `--cursor`, `--gemini`, `--opencode` or `--copilot` (comma list with `--agent claude,cursor` when the user uses several).
4. If `.fxmind/packs.json` already exists, update and keep memories:
   `npx --yes github:proelias7/fxmind --update -y`
   Otherwise install into this project (the knowledge pack is detected from the project; `--project` is required,
   without it the installer only sets up the global parts and leaves the folder untouched):
   `npx --yes github:proelias7/fxmind --claude --project -y`
   Add `--pack web` or `--pack fivem` only if the user asked for a specific pack.
5. Show the user the summary printed by the installer. It creates `.fxmind/`, project skills, hooks and one project-level `fxmind` MCP server. Do not register a second `fxmind` MCP (the plugin MCP with `FXMIND_TARGET` is only for manual setups).
6. Tell the user to restart the agent (or open a new session), then run `/fxmind init` (`$fxmind init` in Codex, `/fxmind:init` in Gemini) so the agent reads the main modules and saves verified facts.
7. Jev AI is optional and off by default. Never ask for its API key in chat. If the user wants it, tell them to run `npx --yes github:proelias7/fxmind jev` in their own terminal (hidden key prompt).

After the restart, verify with a read-only call such as `fxmind_list_memories` or `fxmind_query`. Tool count varies by pack.
