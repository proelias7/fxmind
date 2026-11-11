import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { FxmindActivity, FxmindSnapshot, FxmindUpdate } from '../types'

// The fxmind runtime (MCP + project hooks) does the work; this mod shows it in a
// pane above the chat and offers its actions. A pane, not an AbovePrompt band:
// other mods (effortless) take that slot without passing it on.
const PANE = 'fxmind'
const snapshot = atom({ plugin: 'fxmind', key: 'snapshot' } as const, null)
const activity = atom({ plugin: 'fxmind', key: 'activity' } as const, [])
const updateInfo = atom({ plugin: 'fxmind', key: 'update' } as const, null)
const view = atom({ plugin: 'fxmind', key: 'view' } as const, 'main')

const GATES = ['A', 'B', 'V', 'C'] as const
const NEXT_STEP: Record<string, string> = {
  A: 'carregar memórias (Gate A)',
  B: 'planejar a mudança (Gate B)',
  V: 'verificar e revisar (Gate V)',
  C: 'fechar e aprender (Gate C)',
}
const EDIT_TOOLS = /^(Edit|Write|MultiEdit|NotebookEdit)$/

async function readJson($: EngineInterface, file: string): Promise<any> {
  try {
    return JSON.parse(String(await $.fs.read(file)))
  } catch {
    return null
  }
}

async function home($: EngineInterface): Promise<string | null> {
  const dir = (await $.env.get('USERPROFILE')) || (await $.env.get('HOME'))
  return dir ? dir.replace(/\\/g, '/') : null
}

/** The nearest folder with .fxmind/packs.json, the session's folder first. */
async function projectRoot($: EngineInterface): Promise<string | null> {
  let dir = (await $.session.cwd()).replace(/\\/g, '/')
  for (let depth = 0; depth < 4; depth += 1) {
    if (await $.fs.exists(`${dir}/.fxmind/packs.json`)) return dir
    const parent = dir.replace(/\/[^/]+$/, '')
    if (!parent || parent === dir) break
    dir = parent
  }
  return null
}

// shortcut: reads the in-repo .fxmind/ layout only; projects on the global store show no counts.
async function load($: EngineInterface): Promise<FxmindSnapshot | null> {
  const root = await projectRoot($)
  if (!root) return null
  const state = `${root}/.fxmind/state`
  const mirror = await readJson($, `${state}/fxmind-gates.json`)
  // The session file is the source of truth; the mirror can lag with parallel sessions.
  const session = mirror?.sessionId
    ? (await readJson($, `${state}/sessions/${mirror.sessionId}.json`)) || mirror
    : mirror
  const done = (gate: string) => Boolean(session?.gates?.[gate]?.complete)
  const gates = { A: done('A'), B: done('B'), V: done('V'), C: done('C') }

  const atoms = await readJson($, `${root}/.fxmind/memory/atoms.json`)
  let memories = Array.isArray(atoms?.records) ? atoms.records.length : 0
  try {
    const entries = await $.fs.list(`${root}/.fxmind/memory`)
    memories += entries.filter((f) => f.name.endsWith('.md') && !f.name.startsWith('_')).length
  } catch {}

  const drift = await readJson($, `${root}/.fxmind/drift.json`)
  const stale = new Set(
    (Array.isArray(drift) ? drift.slice(-10) : []).flatMap((d: any) =>
      (d?.hits || []).map((h: any) => h.memoryFile),
    ),
  ).size

  const userHome = await home($)
  const jev = userHome ? String(await $.fs.read(`${userHome}/.fxmind/jev.env`).catch(() => '')) : ''
  const hasJev = /^FXMIND_JEV_API_KEY=.+$/m.test(jev)

  return { isTaskActive: Boolean(session?.taskActive) && !gates.C, gates, memories, stale, hasJev }
}

/** Never throws: a display problem must not touch the tool call or turn it rode on. */
async function refresh($: EngineInterface): Promise<FxmindSnapshot | null> {
  const next = await load($).catch(() => null)
  await update($, snapshot, () => next).catch(() => undefined)
  if (!next) {
    $.ui.status(undefined)
    return null
  }
  const parts = [`fxmind · ${next.memories} memórias`]
  if (next.stale) parts.push(`${next.stale} a rever`)
  $.ui.status(parts.join(' · '))
  return next
}

async function log($: EngineInterface, text: string, tone: FxmindActivity['tone'] = 'info') {
  const at = await $.clock.now().catch(() => Date.now())
  await update($, activity, (list) => [...list, { at, text, tone }].slice(-6)).catch(() => undefined)
}

/** What a finished tool call means for fxmind, in one line, or null. */
function describe(tool: string, input: any, text: string, isError: boolean): [string, FxmindActivity['tone']] | null {
  const short = tool.replace(/^mcp__fxmind__fxmind_/, '')
  if (EDIT_TOOLS.test(tool)) {
    const file = String(input?.file_path || input?.notebook_path || '').replace(/\\/g, '/').split('/').pop()
    if (isError && /Gate|fxmind_start_task|fxmind_claim_paths/.test(text)) {
      return [`edição de ${file} bloqueada: faltam as gates`, 'warn']
    }
    if (/fxmind drift/.test(text)) return [`${file} editado: memórias a rever`, 'warn']
    return isError ? null : [`${file} editado`, 'info']
  }
  if (!tool.startsWith('mcp__fxmind__')) return null
  if (isError) return [`${short}: erro`, 'warn']
  if (short === 'query') {
    const found = /(\d+) memories, (\d+)\/(\d+) tokens/.exec(text)
    return [found ? `consulta: ${found[1]} memórias (${found[2]} tokens)` : 'consulta à memória', 'ok']
  }
  if (short === 'record_gate') {
    const gate = String(input?.gate || '')
    return [`Gate ${gate} registrada`, 'ok']
  }
  if (short === 'start_task') return ['tarefa iniciada', 'info']
  if (short === 'claim_paths') return ['arquivos reservados para este agente', 'info']
  if (short === 'independent_review') return ['revisão independente concluída', 'ok']
  return [short.replace(/_/g, ' '), 'info']
}

function resultText(result: any): string {
  if (typeof result?.text === 'string') return result.text
  const blocks = result?.content ?? result?.result?.content
  return Array.isArray(blocks) ? blocks.map((b: any) => b?.text || '').join('\n') : ''
}

async function checkUpdate($: EngineInterface) {
  await log($, 'buscando atualização...')
  try {
    const result = await $.mcp.call('fxmind', 'fxmind_check_update', { force: true })
    const data = JSON.parse(resultText(result) || '{}')
    const info: FxmindUpdate = {
      local: String(data.localVersion || '?'),
      remote: data.remoteVersion ?? null,
      isAvailable: Boolean(data.updateAvailable),
      message: data.message ?? null,
    }
    await update($, updateInfo, () => info)
    await log($, info.isAvailable ? `atualização disponível: ${info.remote}` : `fxmind ${info.local} está em dia`, info.isAvailable ? 'warn' : 'ok')
  } catch {
    await log($, 'não consegui consultar a atualização (MCP fxmind conectado?)', 'warn')
  }
}

/** Same file and format as `fxmind jev`: KEY="value" lines in ~/.fxmind/jev.env. */
async function saveJev($: EngineInterface, key: string) {
  const clean = key.trim()
  const userHome = await home($)
  if (!clean || !userHome) return
  const file = `${userHome}/.fxmind/jev.env`
  const before = String(await $.fs.read(file).catch(() => ''))
  const kept = before.split(/\r?\n/).filter((l) => l && !/^FXMIND_JEV_(ENABLED|API_KEY)=/.test(l))
  await $.fs.write(file, [...kept, 'FXMIND_JEV_ENABLED="true"', `FXMIND_JEV_API_KEY=${JSON.stringify(clean)}`].join('\n') + '\n')
  await update($, view, () => 'main')
  await refresh($)
  await log($, 'Jev configurada; reinicie a sessão para o MCP usar a chave', 'ok')
}

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'fxmind-panel', description: 'Abre o painel do fxmind acima do chat' }).catch(() => undefined)
    const snap = await refresh($)
    // An open the person did not ask for waits undrawn in narrow windows: point them to the command.
    if (snap) {
      void $.ui.open({ id: PANE, title: 'fxmind' }).then((r) => {
        if (!r.isPlaced) $.ui.status(`fxmind · ${snap.memories} memórias · /fxmind-panel abre o painel`)
      }).catch(() => undefined)
    }
    return next(e)
  })

  on('command.run', { command: 'fxmind-panel' }, async ($) => {
    const snap = await refresh($)
    if (!snap) return { text: 'Este projeto ainda não tem fxmind. Peça: "configure o fxmind neste projeto".' }
    await $.ui.open({ id: PANE, title: 'fxmind' })
    return { text: 'Painel do fxmind aberto.' }
  })

  on('turn.complete', async ($, e, next) => {
    await refresh($)
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const result = await next(e)
    const tool = String(e.tool)
    if (tool.startsWith('mcp__fxmind__') || EDIT_TOOLS.test(tool)) {
      const line = describe(tool, e, resultText(result), Boolean((result as any)?.isError))
      if (line) await log($, line[0], line[1])
      await refresh($)
    }
    return result
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Input, Text } = $.ui.resolve(e)
    const snap = await read($, snapshot)
    if (!snap) return <Text dimColor>Este projeto não tem fxmind.</Text>

    if ((await read($, view)) === 'jev') {
      return (
        <Box flexDirection="column" gap={1}>
          <Text bold>Configurar Jev AI</Text>
          <Text dimColor>A chave fica só em ~/.fxmind/jev.env, nunca no chat nem no repositório.</Text>
          <Input key="jev-key" placeholder="Cole a chave da Jev" submitLabel="Salvar" onSubmit={(v: string) => saveJev($, v)} />
          <Button key="jev-cancel" label="Cancelar" onPress={() => update($, view, () => 'main')} />
        </Box>
      )
    }

    const lines = await read($, activity)
    const upd = await read($, updateInfo)
    const pending = GATES.find((gate) => !snap.gates[gate]) ?? 'C'
    const run = (args: string) => () => $.command.run({ command: 'fxmind', args })

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="row" gap={2}>
          <Text bold color="green">◆ fxmind</Text>
          <Text>{snap.memories} memórias</Text>
          {snap.stale ? <Text color="yellow">{snap.stale} a rever</Text> : <Text dimColor>nada a rever</Text>}
          <Text dimColor>Jev {snap.hasJev ? 'ligada' : 'desligada'}</Text>
          {upd?.isAvailable ? <Text color="yellow">atualização {upd.remote}</Text> : null}
        </Box>

        {snap.isTaskActive ? (
          <Box flexDirection="row" gap={1}>
            <Text dimColor>tarefa</Text>
            {GATES.map((gate) => (
              <Text key={gate} color={snap.gates[gate] ? 'green' : undefined} dimColor={!snap.gates[gate]}>
                {snap.gates[gate] ? `${gate} ✓` : `${gate} ·`}
              </Text>
            ))}
            <Text dimColor>próximo: {NEXT_STEP[pending]}</Text>
          </Box>
        ) : (
          <Text dimColor>Nenhuma tarefa aberta. Edições de código abrem uma tarefa e pedem as Gates A e B.</Text>
        )}

        {lines.length ? (
          <Box flexDirection="column">
            {lines.slice(-4).map((l) => (
              <Text key={String(l.at)} color={l.tone === 'warn' ? 'yellow' : l.tone === 'ok' ? 'green' : undefined} dimColor={l.tone === 'info'}>
                · {l.text}
              </Text>
            ))}
          </Box>
        ) : null}

        <Box flexDirection="row" gap={1}>
          {snap.isTaskActive && snap.gates.V ? <Button key="learn" label="Aprender" onPress={run('learn')} /> : null}
          {snap.stale ? <Button key="health" label="Rever memórias" onPress={run('memory health')} /> : null}
          <Button key="init" label="Mapear projeto" onPress={run('init')} />
          {upd?.isAvailable ? (
            <Button key="do-update" label="Atualizar" onPress={() => $.prompt.submit({ text: 'Atualize o fxmind neste projeto rodando `npx --yes github:proelias7/fxmind --update -y` e me mostre o resumo.' })} />
          ) : (
            <Button key="check" label="Buscar update" onPress={() => checkUpdate($)} />
          )}
          <Button key="jev" label={snap.hasJev ? 'Trocar chave Jev' : 'Configurar Jev'} onPress={() => update($, view, () => 'jev')} />
        </Box>
      </Box>
    )
  })
}
