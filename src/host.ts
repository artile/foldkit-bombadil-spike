import { Effect, Exit, Schema } from 'effect'
import { Port, Runtime, Subscription } from 'foldkit'
import { Action, toMessage, validActions } from './actions'
import { Transport } from './command'
import { Message, Model, Mutant, initialModel } from './model'
import { Observer } from './oracle'
import { ControlledTransport } from './transport'
import { makeUpdate } from './update'
import { makeView } from './view'

declare const TEST_BRIDGE: boolean
const container = document.getElementById('app')
if (!container) throw new Error('Missing app mount')
const mutant = Schema.decodeUnknownSync(Mutant)(new URL(location.href).searchParams.get('mutant') ?? 'clean')
const observer = new Observer(initialModel())
const transport = new ControlledTransport()
const inbound = Port.inbound(Message)
const ports = { inbound: { testMessage: inbound } }
const pureUpdate = makeUpdate(mutant)
const element = Runtime.makeElement({
  Model,
  init: () => ({ model: observer.model }),
  update: (model, message) => {
    const transition = pureUpdate(model, message)
    if (TEST_BRIDGE) observer.observe(model, message, transition.model, transition.commands ?? [])
    return { ...transition, commands: transition.commands?.map(command => ({ ...command, effect: Effect.provideService(command.effect, Transport, transport) })) }
  },
  view: makeView(mutant),
  ...(TEST_BRIDGE ? { ports, subscriptions: Subscription.make<Model, Message>()(() => ({ hostMessage: Port.subscriptionEntry(inbound, message => message) })) } : {}),
  container,
})
const handle = Runtime.embed(element)

const pause = () => new Promise<void>(resolve => setTimeout(resolve, 1))
const settled = async () => {
  const deadline = performance.now() + 3000
  let stable = 0
  let previous = -1
  while (stable < 2) {
    await pause()
    const isRendered = document.getElementById('model')?.textContent === JSON.stringify(observer.model)
    const isRegistered = observer.model.pending.length === transport.pending.size
    stable = isRendered && isRegistered && previous === observer.messages ? stable + 1 : 0
    previous = observer.messages
    if (performance.now() > deadline) throw new Error('Runtime did not settle within 3s')
  }
}

if (TEST_BRIDGE) {
  let semanticActions = 0
  const actionCoverage: Record<string, number> = {}
  const countAction = (action: string) => { semanticActions++; actionCoverage[action] = (actionCoverage[action] ?? 0) + 1 }
  const panel = document.createElement('aside')
  panel.setAttribute('aria-label', 'Test transport controls')
  panel.innerHTML = '<h2>Test transport</h2>'
  for (const action of ['delay', 'success-oldest', 'success-newest', 'fail-oldest', 'fail-newest']) {
    const button = document.createElement('button')
    button.dataset.action = action
    button.textContent = action
    button.onclick = () => transport.act(Schema.decodeUnknownSync(Action)(action))
    panel.append(button)
  }
  document.body.append(panel)
  // Capture intended page separately from the Foldkit handler: a wiring mutant
  // changes OnClick's Message but leaves the visible control's intent intact.
  document.addEventListener('click', event => {
    const target = event.target instanceof Element ? event.target.closest('button') : null
    if (target?.dataset.action) countAction(target.dataset.action)
    if (target?.hasAttribute('data-expected-page')) observer.expectedPage = Number(target.getAttribute('data-expected-page'))
  }, true)
  const bridge = {
    async send(raw: unknown) {
      const message = Schema.decodeUnknownSync(Message)(raw)
      // Replies are owned by the real Command, never supplied through this port.
      if (message._tag === 'SucceededFetchPage' || message._tag === 'FailedFetchPage' || message._tag === 'GotDialogMessage') throw new Error('Only user Messages are accepted by this bridge')
      const result = handle.ports.testMessage.send(message)
      if (Exit.isFailure(result)) throw new Error('Port rejected Message')
      await settled()
    },
    async act(raw: unknown) {
      const action = Schema.decodeUnknownSync(Action)(raw)
      if (!validActions(observer.model, transport.readyIds()).includes(action)) throw new Error(`Invalid action: ${action}`)
      countAction(action)
      const message = toMessage(observer.model, action)
      if (message) await bridge.send(message)
      else { transport.act(action); await settled() }
    },
    settled,
    snapshot: () => ({ ...observer.snapshot(), browser: navigator.userAgent, semanticActions, actionCoverage, tick: transport.tick, readyIds: transport.readyIds(), valid: validActions(observer.model, transport.readyIds()) }),
  }
  Object.defineProperty(window, '__foldkitTest', { value: bridge })
  // Kept in sync after runtime patches, without adding effects to view.
  const refreshControls = () => {
    const valid = validActions(observer.model, transport.readyIds())
    for (const button of panel.querySelectorAll('button')) button.disabled = !valid.includes(Schema.decodeUnknownSync(Action)(button.dataset.action))
  }
  new MutationObserver(refreshControls).observe(document.body, { subtree: true, childList: true, characterData: true })
  panel.addEventListener('click', refreshControls)
  refreshControls()
}
