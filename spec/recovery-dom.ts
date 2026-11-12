import { always } from '@antithesishq/bombadil'
import { actions, extract, getFingerprint } from '@antithesishq/bombadil/browser'
import { state } from './common.ts'
export { properties, noBrowserExceptions } from './common.ts'
const control = extract(({ document, window }) => {
  const bridge = Reflect.get(window, '__foldkitTest')
  if (!bridge) return null
  const action = ['refresh', 'delay', 'fail-newest', 'dismiss'][bridge.snapshot().semanticActions]
  const button = document.querySelector<HTMLButtonElement>(`button[data-action="${action}"]`)
  if (!button || button.disabled) return null
  const rect = button.getBoundingClientRect()
  return { fingerprint: getFingerprint(button), point: { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } }
})
export const semanticActions = actions(() => control.current ? [{ Click: control.current }] : ['Wait'])
export const traceComplete = always(() => !state.current || state.current.semanticActions < 4)
