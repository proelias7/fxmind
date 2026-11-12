import type { EngineInterface } from 'claude-code'

import { tr } from './i18n'

// The fxmind runtime (MCP + project hooks) does the work; the mod says where it stands in one status line: memories,
// what the last edits may have made stale, and the open task's gates. The bar above the prompt (./effort) is the one
// panel the mod draws.

const GATES = ['A', 'B', 'V', 'C'] as const
const EDIT_TOOLS = /^(Edit|Write|MultiEdit|NotebookEdit)$/

type Snapshot = {
  /** A task is open and Gate C is not recorded yet. */
  isTaskActive: boolean
  gates: Record<(typeof GATES)[number], boolean>
  memories: number
  /** Memories the last edits may have made stale (drift log). */
  stale: number
}

async function readJson($: EngineInterface, file: string): Promise<any> {
  try {
    return JSON.parse(String(await $.fs.read(file)))
  } catch {
    return null
  }
}

/** The nearest folder with .fxmind/packs.json, the session's folder first. */
export async function projectRoot($: EngineInterface): Promise<string | null> {
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
async function load($: EngineInterface): Promise<Snapshot | null> {
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

  return { isTaskActive: Boolean(session?.taskActive) && !gates.C, gates, memories, stale }
}

/** The status line's words: "fxmind · 24 memories · 3 to review · task A✓ B✓ V· C·", in the chosen language. */
export function statusText(snap: Snapshot): string {
  const parts = [`fxmind · ${snap.memories} memories`]
  if (snap.stale) parts.push(`${snap.stale} to review`)
  if (snap.isTaskActive) parts.push(`task ${GATES.map((gate) => `${gate}${snap.gates[gate] ? '✓' : '·'}`).join(' ')}`)
  return tr(parts.join(' · '))
}

/** Never throws: a display problem must not touch the tool call or turn it rode on. */
async function refresh($: EngineInterface) {
  const snap = await load($).catch(() => null)
  $.ui.status(snap ? statusText(snap) : undefined)
}

// session.start, turn.complete and tool.call are hooked once per plugin, in ./effort, which calls these three.
export async function statusStart($: EngineInterface) {
  await refresh($)
}

export async function statusTurnEnd($: EngineInterface) {
  await refresh($)
}

/** After a fxmind tool or an edit: the gates and the stale count may have moved. */
export async function statusToolCall($: EngineInterface, e: { tool: string }) {
  const tool = String(e.tool)
  if (tool.startsWith('mcp__fxmind__') || EDIT_TOOLS.test(tool)) await refresh($)
}
