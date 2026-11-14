import type { Register } from 'claude-code'

import { register as registerEffort } from './effort'
import { registerOrchestration } from './orchestration'
import { registerRefine } from './refine'

// One module: the bar above the prompt (./effort), the prompt
// refiner (./refine), and multi-agent orchestration (./orchestration).
export const register: Register = (on, options) => {
  registerEffort(on, options)
  registerRefine(on, options)
  registerOrchestration(on, options)
}
