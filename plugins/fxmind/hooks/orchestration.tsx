import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderInput } from 'claude-code'

import type { OrchestrationConfig, OrchestrationRoutingRule, OrchestrationSession, OrchestrationSubtask } from '../types'
import { AGENTS_PANE } from './agents'
import { projectRoot } from './project-root'
import type { RefineFrame } from './refine'
import { themedEls } from './theme'

type On = Parameters<Register>[0]

const STATE_REL_PATH = '.fxmind/state/orchestrations.json'
const CONFIG_REL_PATH = '.fxmind/orchestration.json'
const POLL_INTERVAL_MS = 2000

export const orchestrationState = atom({ plugin: 'fxmind', key: 'orchestration' } as const, null)

export const DEFAULT_ORCHESTRATION_CONFIG: OrchestrationConfig = {
  enabled: true,
  mode: 'auto',
  strategy: 'smart',
  maxConcurrent: 3,
  routing: {
    rules: [
      { match: 'explore|search|find|read|scout', provider: 'opencode', model: null, effort: 'low' },
      { match: 'review|audit|verify|check', provider: 'claude', model: null, effort: 'high' },
      { match: 'implement|code|refactor|write|fix', provider: 'codex', model: null, effort: 'medium' },
      { match: 'test|unit-test|benchmark', provider: 'opencode', model: null, effort: 'medium' },
      { match: 'query|memory|explain', provider: null, model: null, effort: 'low' },
    ],
    defaultProvider: null,
    defaultModel: null,
    defaultEffort: 'medium',
  },
  allowedProviders: null,
  autoOpenBrowser: true,
}

// Cache by path + mtimeMs (with raw string fallback when $.fs.stat is unavailable).
let cachedPath = ''
let cachedMtimeMs = -1
let cachedRaw = ''
let cachedSession: OrchestrationSession | null = null
let autoOpenedForId = ''
let pollTimer: { cancel: () => void } | undefined

function resetCache() {
  cachedMtimeMs = -1
  cachedRaw = ''
}

function normalizeSession(raw: unknown): OrchestrationSession | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  if (typeof obj.id !== 'string' || !obj.id) return null
  const subtasks = Array.isArray(obj.subtasks) ? (obj.subtasks as OrchestrationSubtask[]) : []
  const terminal = subtasks.filter(s => s.status === 'done' || s.status === 'failed' || s.status === 'cancelled').length
  const progress = typeof obj.progress === 'number'
    ? obj.progress
    : subtasks.length > 0
      ? Math.round((terminal / subtasks.length) * 100)
      : 0
  return {
    id: obj.id,
    task: typeof obj.task === 'string' ? obj.task : 'Task Orchestration',
    status: (obj.status as OrchestrationSession['status']) ?? 'running',
    mode: (obj.mode as OrchestrationSession['mode']) ?? 'auto',
    strategy: typeof obj.strategy === 'string' ? obj.strategy : 'smart',
    createdAt: typeof obj.createdAt === 'string' ? obj.createdAt : new Date().toISOString(),
    updatedAt: typeof obj.updatedAt === 'string' ? obj.updatedAt : new Date().toISOString(),
    completedAt: typeof obj.completedAt === 'string' ? obj.completedAt : null,
    projectRoot: typeof obj.projectRoot === 'string' ? obj.projectRoot : undefined,
    progress,
    subtasks,
    summary: (obj.summary as OrchestrationSession['summary']) ?? null,
  }
}

function pickRelevantSession(list: readonly unknown[]): OrchestrationSession | null {
  const sessions = list.map(normalizeSession).filter((s): s is OrchestrationSession => s !== null)
  if (!sessions.length) return null
  const active = sessions.find(s => s.status === 'running' || s.status === 'awaiting_approval')
  if (active) return active
  const sorted = [...sessions].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
  return sorted[0] ?? null
}

/** Reads the current orchestration session from plugin state. */
export async function readOrchestrationState($: EngineInterface): Promise<OrchestrationSession | null> {
  return read($, orchestrationState)
}

/**
 * Synchronizes `.fxmind/state/orchestrations.json` into plugin state using mtimeMs caching
 * so unchanged files incur zero JSON parsing or UI redraw overhead.
 */
export async function syncOrchestration($: EngineInterface): Promise<OrchestrationSession | null> {
  const root = await projectRoot($).catch(() => null)
  if (!root) {
    if ((await read($, orchestrationState)) !== null) {
      await update($, orchestrationState, () => null)
    }
    return null
  }

  const filePath = `${root}/${STATE_REL_PATH}`
  const fsWithStat = $.fs as typeof $.fs & { stat?: (p: string) => Promise<{ mtimeMs?: number }> }

  if (typeof fsWithStat.stat === 'function') {
    const st = await fsWithStat.stat(filePath).catch(() => null)
    if (!st) {
      cachedPath = filePath
      cachedMtimeMs = -1
      cachedRaw = ''
      cachedSession = null
      if ((await read($, orchestrationState)) !== null) {
        await update($, orchestrationState, () => null)
        $.ui.invalidate('ui.render')
      }
      return null
    }
    if (cachedPath === filePath && typeof st.mtimeMs === 'number' && st.mtimeMs === cachedMtimeMs) {
      return cachedSession
    }
    cachedMtimeMs = typeof st.mtimeMs === 'number' ? st.mtimeMs : -1
  }

  const rawText = await $.fs.read(filePath).catch(() => null)
  if (rawText === null || rawText === undefined) {
    cachedPath = filePath
    cachedMtimeMs = -1
    cachedRaw = ''
    cachedSession = null
    if ((await read($, orchestrationState)) !== null) {
      await update($, orchestrationState, () => null)
      $.ui.invalidate('ui.render')
    }
    return null
  }

  const str = String(rawText)
  if (cachedPath === filePath && str === cachedRaw && cachedSession !== null) {
    return cachedSession
  }

  cachedPath = filePath
  cachedRaw = str

  let next: OrchestrationSession | null = null
  try {
    const parsed = JSON.parse(str)
    if (Array.isArray(parsed)) {
      next = pickRelevantSession(parsed)
    }
  } catch {
    next = cachedSession
  }

  cachedSession = next
  const prev = await read($, orchestrationState)
  const changed =
    (prev?.id ?? null) !== (next?.id ?? null) ||
    (prev?.status ?? null) !== (next?.status ?? null) ||
    (prev?.updatedAt ?? null) !== (next?.updatedAt ?? null) ||
    (prev?.progress ?? null) !== (next?.progress ?? null)

  if (changed) {
    await update($, orchestrationState, () => next)
    if (next && (next.status === 'running' || next.status === 'awaiting_approval') && autoOpenedForId !== next.id) {
      autoOpenedForId = next.id
      void $.ui.open({ id: AGENTS_PANE, title: 'Agents' }).catch(() => undefined)
    }
    $.ui.invalidate('ui.render')
  }

  return next
}

async function approveOrchestrationAction($: EngineInterface, session: OrchestrationSession) {
  await update($, orchestrationState, cur => (cur && cur.id === session.id ? { ...cur, status: 'running' } : cur))
  $.ui.invalidate('ui.render')
  await $.prompt.submit({
    text: `Approve and run orchestration ${session.id}: call fxmind_orchestration_control with orchestrationId "${session.id}" and action "approve".`,
    asUser: true,
  })
}

async function cancelOrchestrationAction($: EngineInterface, session: OrchestrationSession) {
  await update($, orchestrationState, cur =>
    cur && cur.id === session.id
      ? {
          ...cur,
          status: 'cancelled',
          subtasks: cur.subtasks.map(st =>
            st.status === 'pending' || st.status === 'running' ? { ...st, status: 'cancelled', error: 'Cancelled by user' } : st,
          ),
        }
      : cur,
  )
  $.ui.invalidate('ui.render')
  await $.prompt.submit({
    text: `Cancel orchestration ${session.id}: call fxmind_orchestration_control with orchestrationId "${session.id}" and action "cancel".`,
    asUser: true,
  })
}

/**
 * Renders the confirmation banner above the prompt when an orchestration is awaiting approval
 * (`mode: "confirm"`), using the shared FXMind band frame.
 */
export async function orchestrationBand($: EngineInterface, e: RenderInput<'AbovePrompt'>, frame: RefineFrame) {
  await syncOrchestration($)
  const session = await read($, orchestrationState)
  if (!session || session.status !== 'awaiting_approval') return null

  const { Button, Text } = themedEls($.ui.resolve(e))
  const count = session.subtasks.length
  const detail = `${count} subtask${count === 1 ? '' : 's'} · strategy: ${session.strategy}`

  const rows: unknown[][] = [
    [
      <Text key="orch-goal" bold wrap="truncate">
        {session.task}
      </Text>,
    ],
  ]

  const preview = session.subtasks.slice(0, 4)
  for (const st of preview) {
    const deps = st.dependsOn.length ? ` (after ${st.dependsOn.join(', ')})` : ''
    const badge = `[${st.provider || 'agent'} · ${st.effort || 'medium'}]`
    rows.push([
      <Text key={`orch-st-${st.id}`} dimColor wrap="truncate">
        {`${st.index}. ${st.description} ${badge}${deps}`}
      </Text>,
    ])
  }
  if (session.subtasks.length > preview.length) {
    rows.push([
      <Text key="orch-more" dimColor>
        {`+${session.subtasks.length - preview.length} more subtask(s)`}
      </Text>,
    ])
  }

  return frame({
    title: 'Multi-Agent Orchestration',
    detail,
    rows,
    actions: [
      <Button
        key="orch-cancel"
        plain
        dimColor
        label="Cancel"
        onPress={() => cancelOrchestrationAction($, session)}
      />,
      <Button
        key="orch-approve"
        variant="primary"
        label="Approve & Run"
        onPress={() => approveOrchestrationAction($, session)}
      />,
    ],
    onClose: () => cancelOrchestrationAction($, session),
  })
}

/** Reads project `.fxmind/orchestration.json` merged with defaults for the Settings card. */
export async function readProjectOrchestrationConfig($: EngineInterface): Promise<OrchestrationConfig> {
  const root = await projectRoot($).catch(() => null)
  if (!root) return DEFAULT_ORCHESTRATION_CONFIG
  try {
    const raw = await $.fs.read(`${root}/${CONFIG_REL_PATH}`)
    const parsed = JSON.parse(String(raw ?? '{}')) as Partial<OrchestrationConfig>
    const rules: OrchestrationRoutingRule[] =
      parsed.routing && Array.isArray(parsed.routing.rules) && parsed.routing.rules.length
        ? parsed.routing.rules
        : DEFAULT_ORCHESTRATION_CONFIG.routing.rules
    return {
      ...DEFAULT_ORCHESTRATION_CONFIG,
      ...parsed,
      routing: {
        ...DEFAULT_ORCHESTRATION_CONFIG.routing,
        ...(parsed.routing || {}),
        rules,
      },
    }
  } catch {
    return DEFAULT_ORCHESTRATION_CONFIG
  }
}

/** Writes project `.fxmind/orchestration.json` from the Settings card. */
export async function writeProjectOrchestrationConfig($: EngineInterface, nextConfig: OrchestrationConfig): Promise<boolean> {
  const root = await projectRoot($).catch(() => null)
  if (!root) return false
  const payload = {
    ...nextConfig,
    updatedAt: new Date().toISOString(),
  }
  try {
    await $.fs.write(`${root}/${CONFIG_REL_PATH}`, `${JSON.stringify(payload, null, 2)}\n`)
    return true
  } catch {
    return false
  }
}

const ORCH_TOOL_RE = /fxmind_orchestrate|fxmind_orchestration_status|fxmind_orchestration_control/

export function registerOrchestration(on: On, _options: unknown) {
  resetCache()
  cachedSession = null
  autoOpenedForId = ''

  on('session.start', async ($, e, next) => {
    void syncOrchestration($).catch(() => undefined)
    if (pollTimer) {
      pollTimer.cancel()
      pollTimer = undefined
    }
    pollTimer = $.clock.every(POLL_INTERVAL_MS, () => {
      void syncOrchestration($).catch(() => undefined)
    })
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const toolName = String(e.tool || '')
    if (!ORCH_TOOL_RE.test(toolName)) return next(e)

    if (/fxmind_orchestrate$/.test(toolName)) {
      void $.ui.open({ id: AGENTS_PANE, title: 'Agents' }).catch(() => undefined)
    }

    const result = await next(e)
    resetCache()
    await syncOrchestration($).catch(() => undefined)
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (!e.agentId) {
      void syncOrchestration($).catch(() => undefined)
    }
    return result
  })
}
