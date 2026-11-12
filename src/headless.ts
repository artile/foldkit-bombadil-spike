import { Dialog } from '@foldkit/ui'
import { Action, toMessage, validActions } from './actions'
import { Message, Mutant, Request, getPage, initialModel } from './model'
import { Observer, requestFromCommand } from './oracle'
import { makeUpdate } from './update'

// Headless interpreter: executes no browser effects. FetchPage descriptors enter
// a response queue. Native dialog Commands get explicit successful test results.
export class Headless {
  observer = new Observer(initialModel())
  pending = new Map<number, { request: Request, readyAt: number }>()
  tick = 0
  actions = 0
  update: ReturnType<typeof makeUpdate>
  constructor(mutant: Mutant) { this.update = makeUpdate(mutant) }
  readyIds() { return [...this.pending.values()].filter(entry => entry.readyAt <= this.tick).map(entry => entry.request.id).sort((a, b) => a - b) }
  valid() { return validActions(this.observer.model, this.readyIds()) }
  dispatch(message: Message) {
    const before = this.observer.model
    const transition = this.update(before, message)
    this.observer.observe(before, message, transition.model, transition.commands ?? [])
    for (const command of transition.commands ?? []) {
      const request = requestFromCommand(command)
      if (request) this.pending.set(request.id, { request, readyAt: this.tick + 1 })
      else if (command.name === 'ShowDialog') this.dispatch(Message.GotDialogMessage({ message: Dialog.Message.SucceededShowDialog() }))
      else if (command.name === 'CloseDialog') this.dispatch(Message.GotDialogMessage({ message: Dialog.Message.CompletedCloseDialog() }))
      else throw new Error(`Uninterpreted Command ${command.name}`)
    }
  }
  act(action: Action) {
    if (!this.valid().includes(action)) throw new Error(`Invalid headless action ${action}`)
    this.actions++
    const message = toMessage(this.observer.model, action)
    if (message) { this.dispatch(message); return }
    if (action === 'delay') { this.tick++; return }
    const ids = this.readyIds()
    const id = (action === 'success-newest' || action === 'fail-newest') ? ids.at(-1) : ids[0]
    if (id === undefined) throw new Error('No ready request')
    const entry = this.pending.get(id)
    if (!entry) throw new Error('Missing request')
    this.pending.delete(id)
    this.dispatch((action === 'fail-oldest' || action === 'fail-newest') ? Message.FailedFetchPage({ request: entry.request, error: 'Controlled failure' }) : Message.SucceededFetchPage({ request: entry.request, page: getPage(entry.request) }))
  }
}

// Generated integers choose from the *current* valid set. Every generated step
// is one semantic action. This avoids discarding invalid response Messages.
export const runChoices = (mutant: Mutant, choices: ReadonlyArray<number>) => {
  const harness = new Headless(mutant)
  const trace: Array<Action> = []
  for (const choice of choices) {
    const valid = harness.valid()
    const action = valid[choice % valid.length]
    if (!action) throw new Error('Empty action set')
    trace.push(action)
    harness.act(action)
    if (harness.observer.violations.length) break
  }
  return { harness, trace }
}
