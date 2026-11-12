import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderInput } from 'claude-code'

import type { Refine, RefineQuestion } from '../types'
import { projectRoot } from './status'
import { tr } from './i18n'
import { themedEls } from './theme'

// The prompt refiner. A demand to build something is held back before it reaches the agent: Haiku reads it, asks the
// person what a good engineer would need to know, writes the prompt the agent gets (goal, context, requirements,
// scope, done-when), then the chat is cleared and that prompt goes in. Anything else passes through untouched.

type On = Parameters<Register>[0]
type Mode = 'auto' | 'command' | 'off'

const state = atom({ plugin: 'fxmind', key: 'refine' } as const, null)

type RefineWith = 'haiku' | 'sonnet' | 'opus' | 'session'
const WITH: readonly RefineWith[] = ['haiku', 'sonnet', 'opus', 'session']
/** Each model by its id, then the alias a build that does not know the id answers to. */
const MODELS: Record<Exclude<RefineWith, 'session'>, readonly [string, string]> = {
  haiku: ['claude-haiku-5-5', 'haiku'],
  sonnet: ['claude-sonnet-5-5', 'sonnet'],
  opus: ['claude-opus-5-5', 'opus'],
}
/** Haiku reads a demand in a few seconds; a larger model is given longer before the prompt goes on as typed. */
const READ_TIMEOUT_MS = 12_000
const READ_TIMEOUT_LARGE_MS = 40_000
const WRITE_TIMEOUT_MS = 90_000
const MAX_QUESTIONS = 4
/** How much of the chat the writer is shown: the refined prompt must stand without it, since the chat is cleared. */
const CHAT_MESSAGES = 12
const CHAT_MESSAGE_CHARS = 1500

export type RefineConfig = { mode: Mode; with: RefineWith; clear: boolean; send: 'send' | 'fill' }
const DEFAULTS: RefineConfig = { mode: 'auto', with: 'haiku', clear: true, send: 'send' }
let config: RefineConfig = DEFAULTS

/** When the refiner runs now: the setting, or what /fxmind-refine last said. The settings panel shows this. */
export const refineMode = () => config.mode
/** The mode picked in the settings panel, or read at session start. */
export const setRefineMode = (mode: string) => {
  if (mode === 'auto' || mode === 'command' || mode === 'off') config = { ...config, mode }
}
/** The refiner's other settings as the settings panel saved them; the mode is left as it is (see setRefineMode). */
export const applyRefineOptions = (o: { with: string; clear: string; send: string }) => {
  config = { ...config, with: WITH.includes(o.with as RefineWith) ? (o.with as RefineWith) : 'haiku', clear: o.clear !== 'off', send: o.send === 'fill' ? 'fill' : 'send' }
}

/** The refiner's settings as the plugin's options give them (strings); anything else is the default. */
export function readRefineConfig(options: unknown): RefineConfig {
  const o = (options ?? {}) as Record<string, unknown>
  const one = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
    allowed.includes(value as T) ? (value as T) : fallback
  return {
    mode: one(o.refine, ['auto', 'command', 'off'] as const, DEFAULTS.mode),
    with: one(o.refineWith, WITH, DEFAULTS.with),
    clear: one(o.refineClear, ['on', 'off'] as const, 'on') === 'on',
    send: one(o.refineSend, ['send', 'fill'] as const, DEFAULTS.send),
  }
}

// Verbs that start work on the code, Portuguese and English. A cheap first filter: only a message with one of them is
// shown to the model, which has the last word on whether it is a demand to build.
const BUILD_WORDS =
  /\b(implement\w*|cri[ea]\w*|adicion\w*|desenvolv\w*|constru\w*|mont[ea]\w*|fa[çc]a|fazer|refator\w*|corrij\w*|corrig\w*|consert\w*|integr\w*|migr\w*|port[ea]\w*|troqu\w*|substitu\w*|remov\w*|configur\w*|atualiz\w*|melhor\w*|add|build|create|make|write|refactor\w*|fix\w*|change|update|remove|replace|migrate|integrate|port|set up|wire)\b/i

/** Whether a typed message could be a demand to build: long enough to be one, not a command, with a verb of work. */
export function looksLikeDemand(text: string): boolean {
  const said = text.trim()
  return said.length >= 20 && !said.startsWith('/') && BUILD_WORDS.test(said)
}

const READ_SYSTEM = `You prepare the work of a coding agent (Claude Code). You are shown the message a person is about to send it, the end of their chat so far, and facts about the project. Decide two things.

1. Is the message an implementation demand: a request to build, change, fix, refactor or configure something in the project? A question, a request to explain or review, running one command, a go-ahead to a plan and an answer to the agent's own question are not. Neither is a message that continues or corrects work already under way in the chat (a follow-up, a tweak to what was just built): the chat would be cleared, so only a demand that starts new work counts.

2. If it is, what must the person answer before a careful engineer could build it right? Ask only what changes what gets built and cannot be found by reading the code: scope, behaviour in the cases the message leaves open, a choice between real alternatives, how it will be accepted. Never ask what the agent can find in the repository, and never ask to confirm what the message already says. At most ${MAX_QUESTIONS} questions; fewer is better, and none when the demand is already clear. Each question is one short sentence in the person's language. Give 2 to 4 short options when the answer is a choice between known alternatives, otherwise none.

Reply with JSON only: {"implement":true,"questions":[{"q":"...","options":["...","..."]}]} or {"implement":false,"questions":[]}`

const WRITE_SYSTEM = `You write the prompt a coding agent (Claude Code) receives as its only instruction, in a fresh chat with no memory of the one you are shown. You are given the person's demand, their answers to clarifying questions, the end of the chat they had so far, and facts about the project. Write the prompt in the person's language, in Markdown, with these parts, leaving out a part that has nothing to say:

- The goal, first, in one or two sentences: what must exist when the work is done, and why, when the reason is known.
- Context: what the agent needs from the earlier chat and the project to work without them (files named, decisions made, constraints agreed). Only facts you were given: never invent a file, an API or a requirement.
- Requirements: a numbered list, each one specific and checkable. Fold the person's answers in as decisions; do not copy the questions.
- Out of scope: what must not change, when it was said or plainly follows.
- How to work: read the code involved before changing it, follow the project's own patterns, keep the change as small as the goal allows, and ask before anything destructive or hard to undo. Add what the project facts call for.
- Done when: how the result is accepted and checked (tests to run or write, a manual check), and what to report at the end.
- Assumptions: where a question went unanswered and it still matters, the assumption you made, so the agent can question it.

You have not read the repository. Never state what the code has or lacks, what exists or does not exist, or how something works today, unless the chat or the project facts say so: tell the agent to find out by reading the code, and let a premise you cannot check be an assumption.

Keep it as short as the work allows. No filler, no praise, no "You are an expert" preamble, no restating of these instructions. Reply with the prompt only.`

/** What the reader answered: nothing when the reply is not its JSON. Questions without text are dropped. */
export function parseReading(text: string): { implement: boolean; questions: RefineQuestion[] } | undefined {
  const json = text.match(/\{[\s\S]*\}/)?.[0]
  if (!json) return undefined
  try {
    const parsed = JSON.parse(json) as { implement?: unknown; questions?: unknown }
    const list = Array.isArray(parsed.questions) ? parsed.questions : []
    const questions = list
      .map((item): RefineQuestion | undefined => {
        const q = item as { q?: unknown; options?: unknown }
        const said = typeof q?.q === 'string' ? q.q.trim() : ''
        if (!said) return undefined
        const options = Array.isArray(q.options) ? q.options.filter((o): o is string => typeof o === 'string' && !!o.trim()).slice(0, 4) : []
        return { text: said, options, answer: null }
      })
      .filter((q): q is RefineQuestion => q !== undefined)
      .slice(0, MAX_QUESTIONS)
    return { implement: parsed.implement === true, questions }
  } catch {
    return undefined
  }
}

/** The chat's end as text, each message cut short: what the refined prompt has to carry over, since the chat goes. */
export function chatDigest(messages: readonly { role: string; text: string }[]): string {
  return messages
    .filter(m => (m.role === 'user' || m.role === 'assistant') && m.text.trim())
    .slice(-CHAT_MESSAGES)
    .map(m => `${m.role}: ${m.text.trim().slice(0, CHAT_MESSAGE_CHARS)}`)
    .join('\n\n')
}

/** What the writer is shown: the demand, the answers given, the chat's end and the project facts. */
export function writerPrompt(demand: string, questions: readonly RefineQuestion[], chat: string, facts: string): string {
  const answers = questions.map(q => `- ${q.text}\n  ${q.answer?.trim() ? `Answer: ${q.answer.trim()}` : 'Not answered.'}`).join('\n')
  return [
    `# The demand\n${demand.trim()}`,
    answers ? `# Clarifying questions and the person's answers\n${answers}` : '',
    chat ? `# The end of the chat so far (it will be cleared)\n${chat}` : '',
    facts ? `# Project facts\n${facts}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')
}

const FXMIND_FACT =
  'The project uses fxmind (shared project memory with task gates). The agent must follow the fxmind task flow: load the relevant memories first (Gate A), plan the change (Gate B), verify and review it (Gate V), then record what was learned (Gate C).'

async function projectFacts($: EngineInterface): Promise<string> {
  const cwd = await $.session.cwd().catch(() => '')
  const root = await projectRoot($).catch(() => null)
  return [cwd ? `Working folder: ${cwd.replace(/\\/g, '/')}` : '', root ? FXMIND_FACT : ''].filter(Boolean).join('\n')
}

async function chatSoFar($: EngineInterface): Promise<string> {
  return chatDigest(await $.session.messages().catch(() => []))
}

/** The model the person picked (Haiku 5.5 by default, Sonnet 5.5, Opus 5.5 or the chat's own), by its id, then its alias
 * where a build does not know the id. It both reads the demand and writes the prompt. */
async function ask($: EngineInterface, system: string, prompt: string, maxTokens: number, timeoutMs: number) {
  const timeout = timeoutMs === READ_TIMEOUT_MS && config.with !== 'haiku' ? READ_TIMEOUT_LARGE_MS : timeoutMs
  const tries = config.with === 'session' ? [await $.session.model().catch(() => MODELS.haiku[0])] : MODELS[config.with]
  for (const model of tries) {
    const r = await $.model.complete({ model, system, prompt, maxTokens, timeoutMs: timeout })
    if (r.isAnswered) return r.text
  }
  return undefined
}

// A declaration, as every function here that takes $: past an import the engine follows $ only into those.
async function set($: EngineInterface, next: Refine | null) {
  await update($, state, () => next)
  $.ui.invalidate('ui.render')
}

/** The text the refiner last sent in as the person's own: the effort judge reads it as theirs, and it is not refined twice. */
let injected: string | null = null
export function refineInjected(e: { text: string; origin: { kind: string } }): boolean {
  return e.origin.kind === 'plugin' && injected !== null && e.text === injected
}

async function send($: EngineInterface, text: string) {
  injected = text
  await $.prompt.submit({ text, asUser: true })
}

/** Set when the refiner leaves text in the prompt box (the refined prompt to review, or the demand put back by ✕): the
 * person's next send is that text, edited or not, and goes on as typed instead of being refined again. */
let passNext = false
async function fill($: EngineInterface, text: string) {
  passNext = true
  await $.prompt.fill({ text, mode: 'replace' })
}

/** The refined prompt goes in: the chat is cleared first (unless switched off), then it is sent, or left in the prompt box to read. */
async function inject($: EngineInterface, text: string) {
  if (config.clear) await $.command.run({ command: 'clear', args: '' })
  if (config.send === 'fill') {
    await fill($, text)
    $.ui.toast(tr('fxmind: the refined prompt is in the prompt box. Review it and send.'))
    return
  }
  await send($, text)
}

/** Writes the prompt from the demand and the answers, then puts it in. A failure stays in the band, with what to do. */
async function write($: EngineInterface) {
  const now = await read($, state)
  if (!now || now.stage === 'writing') return
  await set($, { ...now, stage: 'writing', error: undefined })
  try {
    const prompt = writerPrompt(now.demand, now.questions, await chatSoFar($), await projectFacts($))
    const text = (await ask($, WRITE_SYSTEM, prompt, 4000, WRITE_TIMEOUT_MS))?.trim()
    if (!text) throw new Error('the model did not answer')
    await set($, null)
    await inject($, text)
  } catch (error) {
    const why = (error instanceof Error ? error.message : String(error)).slice(0, 140)
    await set($, { ...now, stage: 'asking', at: now.questions.length, error: `Could not write the prompt: ${why}` })
  }
}

/** One answer recorded; after the last question the prompt is written. */
async function answer($: EngineInterface, text: string | null) {
  const now = await read($, state)
  if (!now || now.stage !== 'asking' || now.at >= now.questions.length) return
  const questions = now.questions.map((q, i) => (i === now.at ? { ...q, answer: text?.trim() || null } : q))
  const at = now.at + 1
  await set($, { ...now, questions, at, error: undefined })
  if (at >= questions.length) await write($)
}

/** The demand as it was typed goes to the agent, unrefined and with the chat kept. */
async function sendAsTyped($: EngineInterface) {
  const now = await read($, state)
  if (!now) return
  await set($, null)
  await send($, now.demand)
}

/** The refinement is dropped and the demand goes back into the prompt box. */
async function cancel($: EngineInterface) {
  const now = await read($, state)
  if (!now) return
  await set($, null)
  await fill($, now.demand).catch(() => undefined)
}

/** Reads a demand the person asked to refine (/fxmind-refine): asks its questions, or writes at once when it has none. */
async function readDemand($: EngineInterface, demand: string) {
  await set($, { stage: 'reading', demand, questions: [], at: 0 })
  const reply = await ask($, READ_SYSTEM, readerPrompt(demand, await chatSoFar($), await projectFacts($)), 700, READ_TIMEOUT_MS).catch(() => undefined)
  const questions = (reply && parseReading(reply)?.questions) || []
  await set($, { stage: 'asking', demand, questions, at: 0 })
  if (!questions.length) await write($)
}

function readerPrompt(demand: string, chat: string, facts: string): string {
  return [`# The message\n${demand.trim()}`, chat ? `# The end of the chat so far\n${chat}` : '', facts ? `# Project facts\n${facts}` : ''].filter(Boolean).join('\n\n')
}

/**
 * The refiner's turn at a submitted prompt, before anything else sees it. Resolves to a drop when the prompt is held
 * (a demand to refine, or an answer typed in the prompt box), to nothing when it goes on as typed. Never throws.
 */
export async function refineSubmit(
  $: EngineInterface,
  e: { text: string; origin: { kind: string }; turnId?: string; attachments?: readonly unknown[] },
): Promise<{ drop: string } | undefined> {
  try {
    if (e.origin.kind !== 'composer') return undefined
    const said = e.text.trim()
    // A slash command is never a demand nor an answer.
    if (!said || said.startsWith('/')) return undefined
    const now = await read($, state)
    // An answer typed in the prompt box counts as one typed in the band.
    if (now?.stage === 'asking' && now.at < now.questions.length) {
      const last = now.at + 1 >= now.questions.length
      // The last answer starts the writing, which clears the chat and sends: not inside the hook the prompt waits on.
      void answer($, said).catch(() => undefined)
      return { drop: tr(last ? 'fxmind: answer saved, writing the prompt…' : `fxmind: answer ${now.at + 1} of ${now.questions.length} saved`) }
    }
    if (now?.stage === 'asking') return { drop: tr('fxmind: choose above the prompt: Write prompt, Send as typed or ✕') }
    if (now) return { drop: tr('fxmind: wait, the refiner is still on the previous demand (above the prompt)') }
    // The text the refiner left in the box, sent now: the person has read it, so it goes on as typed.
    if (passNext) {
      passNext = false
      return undefined
    }
    // Typed over a running turn it steers that work; with an image the demand is not text alone.
    if (config.mode !== 'auto' || e.turnId !== undefined || e.attachments?.length || !looksLikeDemand(said)) return undefined
    const reply = await ask($, READ_SYSTEM, readerPrompt(said, await chatSoFar($), await projectFacts($)), 700, READ_TIMEOUT_MS)
    const reading = reply ? parseReading(reply) : undefined
    // Not a demand, or the reader failed: the prompt goes on as typed.
    if (!reading?.implement) return undefined
    await set($, { stage: 'asking', demand: e.text, questions: reading.questions, at: 0 })
    if (!reading.questions.length) {
      void write($).catch(() => undefined)
      return { drop: tr('fxmind: the demand is clear, writing the refined prompt…') }
    }
    return { drop: tr(`fxmind: ${reading.questions.length} ${reading.questions.length === 1 ? 'question' : 'questions'} before building. Answer above the prompt.`) }
  } catch {
    return undefined
  }
}

/** What the band says and offers; the bar (./effort) draws it in its own frame, so every band above the prompt looks alike. */
export type RefineFrame = (band: {
  title: string
  /** One dim line beside the title. */
  detail: string
  /** Rows under the title, each a list of parts laid side by side. */
  rows: unknown[][]
  /** The buttons, the main one last. */
  actions: unknown[]
  /** The ✕ in the corner, when the refinement can be dropped. */
  onClose?: () => unknown
}) => Promise<unknown> | unknown

/** The refiner's band above the prompt while it works, or nothing when it is idle. */
export async function refineBand($: EngineInterface, e: RenderInput<'AbovePrompt'>, frame: RefineFrame) {
  const now = await read($, state)
  if (!now) return null
  const { Button, Text } = themedEls($.ui.resolve(e))
  const title = 'Prompt refiner'

  if (now.stage === 'reading' || now.stage === 'writing') {
    return frame({
      title,
      detail: now.stage === 'reading' ? 'reading the demand…' : 'writing the prompt…',
      rows: [[<Text key="refine-demand" dimColor wrap="truncate">{now.demand.trim().replace(/\s+/g, ' ').slice(0, 160)}</Text>]],
      actions: [],
    })
  }

  // An answer is a choice below or a line typed in the prompt box (refineSubmit): one place to type, not two.
  const question = now.questions[now.at]
  const rows: unknown[][] = []
  if (now.error) rows.push([<Text key="refine-error" color="#e0a33a" wrap="truncate">{now.error}</Text>])
  if (question) {
    rows.push([<Text key="refine-question" bold>{question.text}</Text>])
    if (question.options.length)
      rows.push(question.options.map((option, i) => (
        <Button key={`refine-option-${i}`} variant="secondary" label={option} onPress={() => answer($, option)} />
      )))
  }
  return frame({
    title,
    detail: question ? `question ${now.at + 1} of ${now.questions.length} · pick or answer in the chat` : 'ready to write',
    rows,
    actions: [
      ...(question ? [<Button key="refine-skip" plain dimColor label="Skip" onPress={() => answer($, null)} />] : []),
      <Button key="refine-raw" plain dimColor label="Send as typed" onPress={() => sendAsTyped($)} />,
      <Button key="refine-write" variant="primary" label={question ? 'Write now' : now.error ? 'Try again' : 'Write prompt'} onPress={() => write($)} />,
    ],
    onClose: () => cancel($),
  })
}

const MODE_SAID: Record<Mode, string> = {
  auto: 'automatic: implementation demands are refined before they reach the agent',
  command: 'command only: /fxmind-refine <demand>',
  off: 'off',
}

/** At session start: the command. */
export async function refineStart($: EngineInterface) {
  await $.command
    .register({ name: 'fxmind-refine', description: 'Refines a demand before it reaches the agent: /fxmind-refine <demand> | auto | command | off' })
    .catch(() => undefined)
}

/** The mode said with /fxmind-refine is saved as the plugin's own setting, the one the settings panel shows and
 * writes; where the app has no row for it, in the store the settings are read back from at the next start. */
async function keepMode($: EngineInterface, mode: Mode) {
  const { deny } = await $.config
    .set({ key: 'fxmind.refine', value: mode })
    .catch((error: unknown) => ({ deny: error instanceof Error ? error.message : String(error) }))
  const kept = ((await $.store.get('savedSettings').catch(() => null)) ?? {}) as Record<string, string>
  const { refine: _old, ...others } = kept
  await $.store.set('savedSettings', deny ? { ...kept, refine: mode } : others).catch(() => undefined)
}

export function registerRefine(on: On, options: unknown) {
  config = readRefineConfig(options)
  injected = null
  passNext = false

  on('command.run', { command: 'fxmind-refine' }, async ($, e) => {
    const arg = e.args.trim()
    if (arg === 'auto' || arg === 'command' || arg === 'off') {
      config = { ...config, mode: arg }
      await keepMode($, arg)
      if (arg === 'off') await set($, null)
      return { text: tr(`Prompt refiner: ${MODE_SAID[arg]}.`) }
    }
    if (!arg) return { text: tr(`Prompt refiner: ${MODE_SAID[config.mode]}. Use /fxmind-refine <demand>, or auto, command, off.`) }
    if (await read($, state)) return { text: tr('The refiner is already working on a demand (above the prompt).') }
    void readDemand($, arg).catch(() => set($, null))
    return { text: tr('Refining the demand above the prompt.') }
  })
}
