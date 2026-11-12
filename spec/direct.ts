import { actions, registerCustomAction } from '@antithesishq/bombadil/browser'
import { state } from './common.ts'
export { properties, noBrowserExceptions } from './common.ts'

const send = registerCustomAction('foldkitMessage', async (_document, window, action: string) => {
  await Reflect.get(window, '__foldkitTest').act(action)
})
export const semanticActions = actions(() => state.current ? state.current.valid.map((action: string) => send(action)) : ['Wait'])
