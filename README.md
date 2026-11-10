<p align="center">
  <img src="https://i.postimg.cc/Z565rzH8/Chat-GPT-Image-11-09-2026-00-01-28.png" alt="fxmind" width="110" />
</p>

<h1 align="center">fxmind</h1>

<p align="center"><b>One shared memory for every AI agent on your project.</b><br/>
Cursor · Claude Code · Codex · Gemini CLI · OpenCode · Copilot</p>

<p align="center">
  <a href="https://proelias7.github.io/fxmind/">Website</a> ·
  <a href="README.pt-BR.md">Português</a> ·
  <a href="docs/reference.md">Full reference</a>
</p>

---

Your agents forget everything between chats, and each one learns the project from scratch. **fxmind** gives them one memory that lives in your repo, plus expert skills for your stack and a quality checklist they must pass before saying "done".

- **Shared memory** — facts learned by any agent are saved in `.fxmind/memory/`, committed with your code and reused by every agent and teammate.
- **Knowledge packs** — best practices for your stack: **Web** (React, Next.js, Vue, Node, APIs, databases, security, accessibility) and **FiveM** (vRP, QBCore, Qbox, ESX, NUI). The right pack is picked automatically.
- **Verified work** — every change goes through short gates and an independent reviewer before it is accepted.
- **Built for parallel agents** — agents claim the files they edit, so two agents don't overwrite each other.

## Install

Requires [Node.js](https://nodejs.org) 20.9+. Run in your project folder:

```bash
npx --yes github:proelias7/fxmind -y
```

Restart your agent. That's it — just ask for changes in plain language.

## Update

```bash
npx --yes github:proelias7/fxmind --update -y
```

Your memories are kept; only fxmind's own files are refreshed.

## Use

Talk to your agent normally. A few commands help:

| In the agent chat | What it does |
|---|---|
| `/fxmind learn <topic>` | Save what the agent verified about a part of the project |
| `/fxmind create <feature>` | Design a new feature, approve it, then build it |
| `/fxmind audit <folder>` | Security and performance report |

Codex uses `$fxmind`, Gemini uses `/fxmind:learn`.

## Options

```bash
npx --yes github:proelias7/fxmind --claude -y        # pick the agent: --cursor --claude --codex --gemini --opencode --copilot
npx --yes github:proelias7/fxmind --pack web -y      # pick the pack: web, fivem (default: detected)
```

Everything else — MCP tools, hooks, web panel, global install, custom packs — is in the [full reference](docs/reference.md).

## License

MIT — [proelias7](https://github.com/proelias7)
