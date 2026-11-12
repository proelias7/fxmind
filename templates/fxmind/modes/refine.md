# fxmind — Mode: Refine

Turn a rough implementation demand into the prompt a coding agent should receive: ask only what is missing, then write the prompt. **Do not implement anything in this mode** and do not edit files.

Parse `$ARGUMENTS` after `refine`: the demand. Empty → ask the user for the demand in one sentence; stop.

### Step 1 — Read the context (read-only)

1. If the fxmind MCP is registered, call `fxmind_query` with the demand; otherwise check `.fxmind/memory/_index.md` and read only the matching topics.
2. Look at the files or symbols the demand names, enough to know what exists. Never ask the user what the repository already answers.
3. Use what was already said in this chat: decisions, files, constraints.

### Step 2 — Is it a demand to build?

A demand asks to build, change, fix, refactor or configure something in the project. A question, a request to explain or review, one command to run, a go-ahead or a follow-up to work already under way is **not**: say so in one line and handle it normally (implementation follow-ups go to `task.md`). Stop here.

### Step 3 — Ask what is missing

Ask only what changes what gets built and cannot be found by reading the code: scope, behaviour in the cases the demand leaves open, a choice between real alternatives, how it will be accepted. Never ask to confirm what the demand already says.

- **At most 4 questions**; fewer is better; **none** when the demand is already clear (go to Step 4).
- One short sentence each, numbered, in the user's language.
- Give 2–4 short options when the answer is a choice between known alternatives (`a)`, `b)`…), otherwise none.
- Ask them all in **one** message, say the user may answer by number or skip any, then **stop and wait**.

### Step 4 — Write the prompt

Write the prompt in the user's language, in Markdown, inside one fenced block, with these parts (leave out a part that has nothing to say):

- **Goal**, first, in one or two sentences: what must exist when the work is done, and why when known.
- **Context**: what the agent needs from this chat and the project to work without them (files named, decisions made, constraints agreed). Only facts you were given or read — never invent a file, an API or a requirement.
- **Requirements**: numbered, each specific and checkable. Fold the answers in as decisions; do not copy the questions.
- **Out of scope**: what must not change, when it was said or plainly follows.
- **How to work**: read the code involved before changing it, follow the project's own patterns, keep the change as small as the goal allows, ask before anything destructive or hard to undo. In a project with `.fxmind/`, follow the fxmind task flow: load memories (Gate A), plan (Gate B), verify and review (Gate V), record what was learned (Gate C).
- **Done when**: how the result is accepted and checked (tests to run or write, a manual check) and what to report at the end.
- **Assumptions**: for each question left unanswered that still matters, the assumption made, so the agent can question it.

Keep it as short as the work allows. No filler, no praise, no "You are an expert" preamble.

### Step 5 — Hand it over

After the block, one line: the user can run it now here as `/fxmind task` (you then follow `task.md` with the prompt as the goal) or paste it into a new chat. Do not start the task unless the user says so.

### Refine rules

- Read-only until the user asks to run the task.
- Never invent facts in the prompt; unknowns become questions (Step 3) or assumptions (Step 4).
- Reply in the user's language.
