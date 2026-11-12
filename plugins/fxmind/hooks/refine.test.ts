import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { chatDigest, looksLikeDemand, parseReading, readRefineConfig, writerPrompt } from './refine'

const USAGE = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const BAND = {
  plugin: 'fxmind',
  surface: 'desktop',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as never

const DEMAND = 'implemente um endpoint de login com JWT na API'
const TWO_QUESTIONS = JSON.stringify({
  implement: true,
  questions: [
    { q: 'Onde ficam os usuários?', options: ['MySQL', 'Memória'] },
    { q: 'Qual a validade do token?', options: [] },
  ],
})
const REFINED = '# Objetivo\nCriar o endpoint de login com JWT.'

/** What sits beneath the mod: the models answer by role (reader, writer, effort judge), and what goes on is recorded. */
function engine(on: On, reading: string, refined: string | null = REFINED, said: { role: string; text: string }[] = []) {
  const seen = { entered: [] as string[], ran: [] as string[], filled: [] as string[], reader: [] as string[], writer: [] as string[], models: [] as string[] }
  mock.store(on)
  mock.env(on, {})
  const clock = mock.clock(on)
  on('prompt.submit', (_$, e) => {
    seen.entered.push(e.text)
    return { text: e.text }
  })
  on('prompt.fill', (_$, e) => {
    seen.filled.push(e.text)
    return { isFilled: true } as never
  })
  on('command.run', (_$, e) => {
    seen.ran.push(`/${e.command} ${e.args}`.trim())
    return { text: 'ok' }
  })
  on('command.list', () => ({ value: [] as never }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }) as never)
  on('session.messages', () => ({ value: said }) as never)
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.cwd', () => ({ value: 'C:/proj' }))
  on('fs.exists', () => ({ value: false }))
  on('model.complete', (_$, e) => {
    const system = String(e.system ?? '')
    if (system.startsWith('You prepare the work')) {
      seen.models.push(`reader:${e.model}`)
      seen.reader.push(String(e.prompt))
      return { value: { isAnswered: true as const, text: reading, usage: USAGE } }
    }
    if (system.startsWith('You write the prompt')) {
      seen.models.push(`writer:${e.model}`)
      seen.writer.push(String(e.prompt))
      return refined === null
        ? ({ value: { isAnswered: false as const, reason: 'api-error', usage: USAGE } } as never)
        : { value: { isAnswered: true as const, text: refined, usage: USAGE } }
    }
    return { value: { isAnswered: true as const, text: '{"model":"opus","effort":"medium","why":"a build"}', usage: USAGE } }
  })
  return { seen, clock }
}

const type = ($: Engine, text: string) => $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } })
const drawn = async (ui: { drawn: () => Promise<unknown> }) => JSON.stringify(await ui.drawn())

describe('refiner rules', () => {
  test('looksLikeDemand: a verb of work in a message long enough, never a command or a short go-ahead', async () => {
    expect(looksLikeDemand(DEMAND)).toBe(true)
    expect(looksLikeDemand('add a dark mode toggle to the settings page')).toBe(true)
    expect(looksLikeDemand('como funciona o cache de prompt?')).toBe(false)
    expect(looksLikeDemand('ok, faça')).toBe(false)
    expect(looksLikeDemand('/fxmind-refine implemente o login com JWT')).toBe(false)
  })

  test('parseReading keeps real questions, at most four, and nothing from a reply that is not its JSON', async () => {
    expect(parseReading('not json')).toBeUndefined()
    expect(parseReading('{"implement":false,"questions":[]}')).toEqual({ implement: false, questions: [] })
    const read = parseReading(`Sure:\n${JSON.stringify({ implement: true, questions: [{ q: ' A? ', options: ['x', '', 3] }, { q: '' }, { q: 'B?' }, { q: 'C?' }, { q: 'D?' }, { q: 'E?' }] })}`)
    expect(read?.implement).toBe(true)
    expect(read?.questions.map(q => q.text)).toEqual(['A?', 'B?', 'C?', 'D?'])
    expect(read?.questions[0]).toEqual({ text: 'A?', options: ['x'], answer: null })
  })

  test('the writer is shown the demand, each answer or that it has none, the chat and the project facts', async () => {
    const chat = chatDigest([{ role: 'system', text: 'x' }, { role: 'user', text: ' usamos Express ' }, { role: 'assistant', text: '' }])
    expect(chat).toBe('user: usamos Express')
    const prompt = writerPrompt(DEMAND, [{ text: 'A?', options: [], answer: 'MySQL' }, { text: 'B?', options: [], answer: null }], chat, 'Working folder: C:/proj')
    expect(prompt).toContain(DEMAND)
    expect(prompt).toContain('- A?\n  Answer: MySQL')
    expect(prompt).toContain('- B?\n  Not answered.')
    expect(prompt).toContain('user: usamos Express')
    expect(prompt).toContain('Working folder: C:/proj')
  })

  test('readRefineConfig: auto, Haiku, clear and send unless set otherwise', async () => {
    expect(readRefineConfig(undefined)).toEqual({ mode: 'auto', with: 'haiku', clear: true, send: 'send' })
    expect(readRefineConfig({ refine: 'command', refineWith: 'session', refineClear: 'off', refineSend: 'fill' })).toEqual({ mode: 'command', with: 'session', clear: false, send: 'fill' })
    expect(readRefineConfig({ refine: 'sometimes' }).mode).toBe('auto')
    expect(readRefineConfig({ refineWith: 'opus' }).with).toBe('opus')
    expect(readRefineConfig({ refineWith: 'gpt' }).with).toBe('haiku')
  })
})

describe('refiner', () => {
  test('a question goes on as typed, and no reader is asked', async ($, on) => {
    const { seen } = engine(on, TWO_QUESTIONS)
    const result = await type($, 'como funciona o cache de prompt?')
    expect(result.drop).toBeUndefined()
    expect(seen.entered).toEqual(['como funciona o cache de prompt?'])
    expect(seen.reader).toEqual([])
  })

  test('a message the reader says is no demand goes on as typed', async ($, on) => {
    const { seen } = engine(on, '{"implement":false,"questions":[]}')
    const result = await type($, 'crie uma lista do que mudou neste arquivo, só para eu ler')
    expect(result.drop).toBeUndefined()
    expect(seen.entered).toHaveLength(1)
    expect(seen.reader).toHaveLength(1)
  })

  test('a demand is held, its doubts asked in the band; the answers make the prompt, the chat is cleared and it goes in', async ($, on) => {
    const { seen, clock } = engine(on, TWO_QUESTIONS, REFINED, [{ role: 'user', text: 'a API usa Express' }])
    const result = await type($, DEMAND)
    expect(String(result.drop)).toContain('2 questions')
    expect(seen.entered).toEqual([])
    expect(seen.reader[0]).toContain(DEMAND)
    expect(seen.reader[0]).toContain('a API usa Express')

    const band = await $.ui.mount(BAND)
    expect(await drawn(band)).toContain('Onde ficam os usuários?')
    expect(await drawn(band)).toContain('question 1 of 2')
    await band.press({ key: 'refine-option-0' })
    expect(await drawn(band)).toContain('Qual a validade do token?')
    // No second input in the band: an open answer goes in the prompt box.
    expect(await band.find({ key: 'refine-answer-1' }).catch(() => undefined)).toBeUndefined()
    await type($, '15 minutos')
    await clock.advance(10)

    expect(seen.writer).toHaveLength(1)
    expect(seen.writer[0]).toContain('Answer: MySQL')
    expect(seen.writer[0]).toContain('Answer: 15 minutos')
    expect(seen.writer[0]).toContain('a API usa Express')
    // The chat is cleared first, then the refined prompt enters in the demand's place.
    expect(seen.ran).toEqual(['/clear'])
    expect(seen.entered).toEqual([REFINED])
    await band.unmount()
    // Idle again: the refiner's band is gone.
    const after = await $.ui.mount(BAND).catch(() => null)
    if (after) expect(await drawn(after)).not.toContain('Prompt refiner')
  })

  test('an answer typed in the prompt box counts; the last one starts the writing', async ($, on) => {
    const { seen, clock } = engine(on, TWO_QUESTIONS)
    await type($, DEMAND)
    expect(String((await type($, 'MySQL')).drop)).toContain('answer 1 of 2')
    expect(String((await type($, '15 minutos')).drop)).toContain('writing the prompt')
    await clock.advance(10)
    expect(seen.writer[0]).toContain('Answer: MySQL')
    expect(seen.writer[0]).toContain('Answer: 15 minutos')
    expect(seen.entered).toEqual([REFINED])
  })

  test('a clear demand has no questions: it is written at once', async ($, on) => {
    const { seen, clock } = engine(on, '{"implement":true,"questions":[]}')
    expect(String((await type($, DEMAND)).drop)).toContain('the demand is clear')
    await clock.advance(10)
    expect(seen.ran).toEqual(['/clear'])
    expect(seen.entered).toEqual([REFINED])
  })

  test('Pular leaves a question unanswered; Enviar sem refinar sends the demand as typed and keeps the chat', async ($, on) => {
    const { seen } = engine(on, TWO_QUESTIONS)
    await type($, DEMAND)
    const band = await $.ui.mount(BAND)
    await band.press({ key: 'refine-skip' })
    expect(await drawn(band)).toContain('question 2 of 2')
    await band.press({ key: 'refine-raw' })
    expect(seen.writer).toEqual([])
    expect(seen.ran).toEqual([])
    expect(seen.entered).toEqual([DEMAND])
    await band.unmount()
  })

  test('Cancelar drops the refinement and puts the demand back in the prompt box', async ($, on) => {
    const { seen } = engine(on, TWO_QUESTIONS)
    await type($, DEMAND)
    const band = await $.ui.mount(BAND)
    expect(await drawn(band)).toContain('✕')
    await band.press({ key: 'refine-cancel' })
    expect(seen.filled).toEqual([DEMAND])
    expect(seen.entered).toEqual([])
    await band.unmount()
  })

  test('with clear off and fill, the chat is kept and the prompt waits in the prompt box', { options: { refineClear: 'off', refineSend: 'fill' } } as never, async ($, on) => {
    const { seen } = engine(on, TWO_QUESTIONS)
    await type($, DEMAND)
    const band = await $.ui.mount(BAND)
    await band.press({ key: 'refine-write' })
    expect(seen.ran).toEqual([])
    expect(seen.filled).toEqual([REFINED])
    expect(seen.entered).toEqual([])
    await band.unmount()
  })

  test('the prompt left in the box to review goes on as sent, not refined again', { options: { refineClear: 'off', refineSend: 'fill' } } as never, async ($, on) => {
    const { seen } = engine(on, TWO_QUESTIONS)
    await type($, DEMAND)
    const band = await $.ui.mount(BAND)
    await band.press({ key: 'refine-write' })
    await band.unmount()
    expect(seen.filled).toEqual([REFINED])
    const readers = seen.reader.length
    expect((await type($, `${REFINED}
implemente também o refresh token`)).drop).toBeUndefined()
    expect(seen.reader).toHaveLength(readers)
    expect(seen.entered.at(-1)).toContain('refresh token')
    // Only that one send: the next demand is refined again.
    expect(String((await type($, DEMAND)).drop)).toContain('2 questions')
  })

  test('the demand put back by ✕ goes on as sent', async ($, on) => {
    const { seen } = engine(on, TWO_QUESTIONS)
    await type($, DEMAND)
    const band = await $.ui.mount(BAND)
    await band.press({ key: 'refine-cancel' })
    await band.unmount()
    expect((await type($, DEMAND)).drop).toBeUndefined()
    expect(seen.entered).toEqual([DEMAND])
  })

  test('Haiku 5.5 reads and writes by default', async ($, on) => {
    const { seen } = engine(on, TWO_QUESTIONS)
    await type($, DEMAND)
    const band = await $.ui.mount(BAND)
    await band.press({ key: 'refine-write' })
    await band.unmount()
    expect(seen.models).toEqual(['reader:claude-haiku-5-5', 'writer:claude-haiku-5-5'])
  })

  test('Opus 5.5, when picked, reads the demand and writes the prompt', { options: { refineWith: 'opus' } } as never, async ($, on) => {
    const { seen } = engine(on, TWO_QUESTIONS)
    await type($, DEMAND)
    const band = await $.ui.mount(BAND)
    await band.press({ key: 'refine-write' })
    await band.unmount()
    expect(seen.models).toEqual(['reader:claude-opus-5-5', 'writer:claude-opus-5-5'])
    expect(seen.entered).toEqual([REFINED])
  })

  test("the chat's model, when picked, is the session's", { options: { refineWith: 'session' } } as never, async ($, on) => {
    const { seen } = engine(on, TWO_QUESTIONS)
    await type($, DEMAND)
    expect(seen.models).toEqual(['reader:claude-opus-5-5'])
  })

  test('a writer that fails says so in the band and nothing is cleared or sent', async ($, on) => {
    const { seen } = engine(on, TWO_QUESTIONS, null)
    await type($, DEMAND)
    const band = await $.ui.mount(BAND)
    await band.press({ key: 'refine-write' })
    expect(await drawn(band)).toContain('Could not write the prompt')
    expect(await band.find({ key: 'refine-raw' })).toBeDefined()
    expect(seen.ran).toEqual([])
    expect(seen.entered).toEqual([])
    await band.unmount()
  })

  test('command mode: prompts go on as typed, /fxmind-refine <demand> refines one', { options: { refine: 'command' } } as never, async ($, on) => {
    const { seen, clock } = engine(on, TWO_QUESTIONS)
    expect((await type($, DEMAND)).drop).toBeUndefined()
    expect(seen.reader).toEqual([])
    seen.entered.length = 0
    await $.command.run({ command: 'fxmind-refine', args: DEMAND } as never)
    await clock.advance(10)
    const band = await $.ui.mount(BAND)
    expect(await drawn(band)).toContain('Onde ficam os usuários?')
    await band.press({ key: 'refine-write' })
    expect(seen.entered).toEqual([REFINED])
    await band.unmount()
  })

  test('/fxmind-refine off switches it off', async ($, on) => {
    const { seen } = engine(on, TWO_QUESTIONS)
    const reply = await $.command.run({ command: 'fxmind-refine', args: 'off' } as never)
    expect(String(reply.text)).toContain('off')
    expect((await type($, DEMAND)).drop).toBeUndefined()
    expect(seen.entered).toEqual([DEMAND])
  })
  test('in pt-BR the band, the drops and the command speak Portuguese', { options: { language: 'pt-BR' } } as never, async ($, on) => {
    const { seen } = engine(on, TWO_QUESTIONS)
    expect(String((await type($, DEMAND)).drop)).toContain('2 dúvidas antes de implementar')
    const band = await $.ui.mount(BAND)
    expect(await drawn(band)).toContain('Refinador de prompt')
    expect(await drawn(band)).toContain('dúvida 1 de 2')
    expect(await drawn(band)).toContain('Enviar sem refinar')
    await band.press({ key: 'refine-cancel' })
    expect(seen.filled).toEqual([DEMAND])
    await band.unmount()
    const reply = await $.command.run({ command: 'fxmind-refine', args: 'off' } as never)
    expect(String(reply.text)).toBe('Refinador de prompt: desligado.')
  })
})
