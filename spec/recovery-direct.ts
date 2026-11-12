import { always } from '@antithesishq/bombadil'
import { actions, registerCustomAction } from '@antithesishq/bombadil/browser'
import { state } from './common.ts'
export { properties, noBrowserExceptions } from './common.ts'
const trace = ['refresh', 'delay', 'fail-newest', 'dismiss']
const send = registerCustomAction('foldkitMessage', async (_document, window, action: string) => {
  await Reflect.get(window, '__foldkitTest').act(action)
})
export const semanticActions = actions(() => state.current && trace[state.current.semanticActions] ? [send(trace[state.current.semanticActions]!)] : ['Wait'])
export const traceComplete = always(() => !state.current || state.current.semanticActions < 4)
