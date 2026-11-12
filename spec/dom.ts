import { actions, extract, getFingerprint } from '@antithesishq/bombadil/browser'
export { properties, noBrowserExceptions } from './common.ts'

const controls = extract(({ document, window }) => {
  const bridge = Reflect.get(window, '__foldkitTest')
  if (!bridge) return []
  const valid = bridge.snapshot().valid
  return [...document.querySelectorAll<HTMLButtonElement>('button[data-action]')]
    .filter(button => valid.includes(button.dataset.action) && !button.disabled && button.getBoundingClientRect().width > 0)
    .map(button => {
      const rect = button.getBoundingClientRect()
      return { fingerprint: getFingerprint(button), point: { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } }
    })
})
export const semanticActions = actions(() => controls.current.length ? controls.current.map(Click => ({ Click })) : ['Wait'])
