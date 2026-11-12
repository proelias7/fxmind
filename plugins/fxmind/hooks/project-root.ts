import type { EngineInterface } from 'claude-code'

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
