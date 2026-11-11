export type FxmindSnapshot = {
  /** A task is open and Gate C is not recorded yet. */
  isTaskActive: boolean
  gates: { A: boolean; B: boolean; V: boolean; C: boolean }
  memories: number
  /** Memories the last edits may have made stale (drift log). */
  stale: number
  /** Jev key saved in ~/.fxmind/jev.env. */
  hasJev: boolean
}

/** One line of what fxmind did this session, newest last. */
export type FxmindActivity = { at: number; text: string; tone: 'ok' | 'warn' | 'info' }

export type FxmindUpdate = { local: string; remote: string | null; isAvailable: boolean; message: string | null }

declare module 'claude-code' {
  interface PluginState {
    fxmind: {
      snapshot: FxmindSnapshot | null
      activity: FxmindActivity[]
      update: FxmindUpdate | null
      /** Which body the pane shows. */
      view: 'main' | 'jev'
    }
  }
}
