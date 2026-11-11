import type { Register } from 'claude-code'

import { register as registerEffort } from './effort'
import { registerRefine } from './refine'

// One module: the bar above the prompt (./effort), which also keeps the fxmind status line (./status), and the prompt
// refiner (./refine).
export const register: Register = (on, options) => {
  registerEffort(on, options)
  registerRefine(on, options)
}
