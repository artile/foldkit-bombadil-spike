import { always } from '@antithesishq/bombadil'
import { actions, registerCustomAction } from '@antithesishq/bombadil/browser'
import { state } from './common.ts'
import { trace } from './trace.ts'
export { properties, noBrowserExceptions } from './common.ts'
const send = registerCustomAction('foldkitMessage', async (_document, window, action: string) => {
  await Reflect.get(window, '__foldkitTest').act(action)
})
export const semanticActions = actions(() => {
  if (!state.current) return ['Wait']
  const action = trace[state.current.semanticActions]
  return action ? [send(action)] : ['Wait']
})
// Deliberate stop marker, excluded from bug detection counts.
export const traceComplete = always(() => !state.current || state.current.semanticActions < trace.length)
