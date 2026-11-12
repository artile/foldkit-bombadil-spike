import { always } from '@antithesishq/bombadil'
import { extract } from '@antithesishq/bombadil/browser'

// Browser functions are self-contained: Bombadil serializes these closures.
export const state = extract(({ window }) => {
  const bridge = Reflect.get(window, '__foldkitTest')
  return bridge ? bridge.snapshot() : null
})
export const properties = always(() => state.current === null || state.current.violations.length === 0)
const exceptions = extract(({ errors }) => errors.uncaughtExceptions.length)
export const noBrowserExceptions = always(() => exceptions.current === 0)
