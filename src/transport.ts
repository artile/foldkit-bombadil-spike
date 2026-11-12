import { Effect } from 'effect'
import { Action } from './actions'
import { Message, Request, Reply, getPage } from './model'

// No timer, network or random reply. Logical time advances only on Delay.
// The map contains live Effect continuations, not invented response Messages.
export class ControlledTransport {
  tick = 0
  pending = new Map<number, { request: Request, readyAt: number, resume: (message: Reply) => void }>()
  wait = (request: Request): Effect.Effect<Reply> => Effect.callback(resume => {
    this.pending.set(request.id, { request, readyAt: this.tick + 1, resume: message => resume(Effect.succeed(message)) })
    return Effect.sync(() => { this.pending.delete(request.id) })
  })
  readyIds() { return [...this.pending.values()].filter(entry => entry.readyAt <= this.tick).map(entry => entry.request.id).sort((a, b) => a - b) }
  act(action: Action) {
    if (action === 'delay') { this.tick++; return }
    const ids = this.readyIds()
    const id = (action === 'success-newest' || action === 'fail-newest') ? ids.at(-1) : ids[0]
    if (id === undefined) throw new Error('Response action without a ready pending Command')
    const entry = this.pending.get(id)
    if (!entry) throw new Error('Missing continuation')
    this.pending.delete(id)
    entry.resume((action === 'fail-oldest' || action === 'fail-newest') ? Message.FailedFetchPage({ request: entry.request, error: 'Controlled failure' }) : Message.SucceededFetchPage({ request: entry.request, page: getPage(entry.request) }))
  }
}
