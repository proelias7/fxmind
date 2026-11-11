import type { Register } from 'claude-code'

import { register as registerEffort } from './effort'
import { registerPane } from './pane'
import { registerRefine } from './refine'

// One module, three parts: the effort bar above the prompt (./effort), the fxmind pane (./pane) and the prompt
// refiner (./refine).
export const register: Register = (on, options) => {
  registerEffort(on, options)
  registerPane(on)
  registerRefine(on, options)
}
