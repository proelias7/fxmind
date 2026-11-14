---
name: fxmind
description: "Use for code/config changes in projects with .fxmind/, for /fxmind commands (shared memory, domain skills, task gates, verification and learning), and in a repository with no .fxmind/ yet, to offer installing it."
---

# fxmind

Shared knowledge lives under `.fxmind/`; domain skills live in `.fxmind/skills/`, not the agent's skills directory. Every agent and teammate on the project reads and writes the same memory — leave it better than you found it.

## Repository without fxmind

If the project root has no `.fxmind/packs.json`, fxmind's memory is not installed in this repository yet. Say so in one line and offer to install it; never install without the user's yes. On yes, follow the `fxmind-setup` skill (it runs the project installer and keeps any existing memories), then tell the user to restart the agent and run `/fxmind init` (`$fxmind init` in Codex). In Claude Code the fxmind panel offers the same above the prompt. If the user says no, carry on without fxmind and do not offer again in this conversation.

## Routing

- Explicit `/fxmind init [scope]`: read `.fxmind/modes/init.md` (read main modules, save source-grounded facts and map the project; no application code changes).

- Code/config implementation, including "analyze and fix": read `.fxmind/modes/task.md`.
- New resource/feature/module: read `.fxmind/modes/create.md` (design + approval before code).
- Large rewrite/optimization of existing code: read `.fxmind/modes/refactor.md`.
- Review/question only: investigate and answer; do not turn it into implementation.
- Explicit `/fxmind judge`: read `.fxmind/modes/judge.md`.
- Explicit `/fxmind teach <name>`: read `.fxmind/modes/teach.md` (turn a task that worked into a playbook).
- Other `/fxmind` commands: read `.fxmind/fxmind.md`, then only the matching mode.
- Verification: read `.fxmind/modes/task-verify.md`; for UI, read it before editing to prepare browser checks.

Quick/full adjusts effort and narration, not quality requirements. Quick does not imply trivial. Only known tiny changes without new behavior qualify for auto A/B.

## Lean engineering (all coding agents and delegated reviewers)

Use the existing Gate B to choose the **smallest complete solution**: first ask whether new code is needed, search for existing helpers/events/components and playbooks, then prefer platform/standard APIs or installed dependencies. Only introduce new code, abstraction, configuration or dependency when those options cannot satisfy the task. Check the affected callers and source; FXMIND's optional compact symbol map is just a hint, not an authoritative AST. Search the entry points the pack names (events/exports for FiveM, routes/actions/components for web) and keep existing security/permission checks. Do not cut requirements, failure handling, privacy, tests or UI verification to reduce lines. In Gate V, independently review unnecessary duplication, scope creep and missed tests as well as functional correctness. The same criteria apply to subagents; no new Gate or mandatory MCP call is required.

## Context and control

When choosing between FxMind discovery tools is ambiguous, call `fxmind_route_tool` once (advisory only). It proposes a read-only MCP tool; it does not call it, authorize actions or replace gates. If the preloaded context already recommends a tool, use that hint instead of calling the router again. Follow known playbooks and preloaded memories first.

A `# fxmind — playbook` block in the preloaded context is the procedure for a repeated request: follow its files/anchors, skip discovery, pass `kind` + `playbook` to `fxmind_start_task`. Task kind (config / fix / mechanic / create) is stated at Gate A; see `task.md`. For repository-specific questions or tasks needing code context, use preloaded precise facts first, otherwise call `fxmind_query` once before generic Grep. For ordinary non-repository questions, answer directly without memory lookup or gates. Read source to confirm memory claims. If retrieval lacks coverage, call bounded `fxmind_search` first; only then use native Grep/ripgrep as fallback or verification. If MCP is disconnected, say so and fall back to native search; never invent paths or repeat blind queries. Load only relevant references/corrections.

Gates are MCP-managed: start → A → B → implement/checks → **V auto-review** → C. Every `fxmind_record_gate(V)` automatically dispatches a fresh read-only reviewer, preferring a strong model from the same provider and loading the installed pack's rubric. Strict VERIFIED is required. If V returns findings, fix them without asking the user, rerun affected checks and retry V; edits make the previous review stale. Never write gate/session JSON directly. Missing MCP prevents gate-controlled edits but need not prevent read-only investigation.

Read gate requirements from the mode files instead of duplicating them in chat. User-facing replies stay short and direct: outcome first, no long explanations. Failed/blocked V stays open. Browser interaction, screenshot inspection and console observations are required for UI; build alone is insufficient. State missing verification honestly.

## Working with other agents

Several agents (IDE tabs, CLIs, panel threads, subagents, teammates) may work on the same project at once.

- Keep your `sessionId` for the whole task; never reuse another agent's session.
- After Gate B, call `fxmind_claim_paths` for the files you will edit. If a path is claimed by another active session, do not edit it: pick other work, wait, or tell the user. `fxmind_session_status` lists active sessions and claims; `fxmind_release_paths` frees paths you no longer need (Gate C releases all).
- Delegated subagents (`fxmind_subagent_run`) work inside your claimed scope and report back; you record the gates.
- Memory is shared: query before you learn, extend or correct an existing fact instead of creating a near-duplicate, and never delete another agent's memory without evidence that it is wrong.

## Domain routing

Read only installed entries from `.fxmind/skills/_index.md`. `.fxmind/policy/domain-routing.md` is the installed packs' routing, unit of work, stack detection, tool and verification rules for this project — follow it. The pack principles it names under `.fxmind/policy/` (e.g. `fivem-principles.md`, `web-principles.md`) are binding; cite their IDs at Gate A/B and in the Gate V review.

## Memory

Learned facts are atomic and source-linked: `/fxmind learn` stores one concise fact per verified claim with `fxmind_graph.addFact` (exact evidence copied from an existing source file). They are saved in `.fxmind/memory/atoms.json`, next to the topic Markdown, and committed with the code so every agent and teammate shares them; a fact stays active while its evidence still exists in the source. Generated indexes under `.fxmind/graph/` are local caches (rebuilt with `fxmind graph`). With the optional global store, the same files live under `~/.fxmind/projects/<id>/`. Legacy Markdown under `.fxmind/memory/` is preserved and indexed. Audits and corrections remain under `.fxmind/audits/` and `.fxmind/corrections/`. Save verified reusable knowledge, preserve existing decisions. Stop immediately when the user asks.
