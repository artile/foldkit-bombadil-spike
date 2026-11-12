import { Schema } from 'effect'
import { Message, Model } from './model'

export const Action = Schema.Literals(['search-a', 'search-b', 'search-all', 'next', 'previous', 'refresh', 'delay', 'success-oldest', 'success-newest', 'fail-oldest', 'fail-newest', 'dismiss', 'retry'])
export type Action = typeof Action.Type
export const toMessage = (model: Model, action: Action): Message | undefined => {
  switch (action) {
    case 'search-a': return Message.UpdatedQuery({ query: 'a' })
    case 'search-b': return Message.UpdatedQuery({ query: 'b' })
    case 'search-all': return Message.UpdatedQuery({ query: '' })
    case 'next': return Message.ClickedPage({ page: Math.min(4, model.page + 1) })
    case 'previous': return Message.ClickedPage({ page: Math.max(1, model.page - 1) })
    case 'refresh': return Message.ClickedRefresh()
    case 'dismiss': return Message.ClickedDismiss()
    case 'retry': return Message.ClickedRetry()
    default: return undefined
  }
}
export const validActions = (model: Model, readyIds: ReadonlyArray<number>): Array<Action> => {
  if (model.dialog.isOpen) return ['dismiss', 'retry']
  return [
    'search-a', 'search-b', 'search-all', 'refresh', 'delay',
    ...(model.page < 4 ? ['next' as const] : []),
    ...(model.page > 1 ? ['previous' as const] : []),
    ...(readyIds.length ? ['success-oldest' as const, 'success-newest' as const, 'fail-oldest' as const, 'fail-newest' as const] : []),
  ]
}
