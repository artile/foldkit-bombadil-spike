import { AsyncData } from 'foldkit'
import { HtmlBuilder } from 'foldkit/html'
import { Button, Dialog, Input } from '@foldkit/ui'
import { Message, Model, Mutant } from './model'

const button = (h: HtmlBuilder<Message>, action: string, label: string, message: Message) => Button.view({
  onClick: message,
  toView: attributes => h.button([...attributes.button, h.DataAttribute('action', action), ...(message._tag === 'ClickedPage' ? [h.DataAttribute('expected-page', String(message.page))] : [])], [label]),
}, h)

export const makeView = (mutant: Mutant) => (model: Model, h: HtmlBuilder<Message>) => h.main([], [
  h.h1([], ['Foldkit catalogue']),
  h.p([], ['A loopback-only test fixture. Choose a query, change pages, and control pending responses.']),
  Input.view({ id: 'query', value: model.query, onInput: query => Message.UpdatedQuery({ query }), toView: attributes => h.input([...attributes.input, h.AriaLabel('Search catalogue')]) }, h),
  h.nav([h.AriaLabel('Query presets')], [
    button(h, 'search-all', 'All items', Message.UpdatedQuery({ query: '' })),
    button(h, 'search-a', 'Search a', Message.UpdatedQuery({ query: 'a' })),
    button(h, 'search-b', 'Search b', Message.UpdatedQuery({ query: 'b' })),
    button(h, 'refresh', 'Refresh', Message.ClickedRefresh()),
  ]),
  h.nav([h.AriaLabel('Pages')], [
    ...(model.page > 1 ? [button(h, 'previous', 'Previous page', Message.ClickedPage({ page: model.page - 1 }))] : []),
    h.span([h.Id('page-number')], [`Page ${model.page}`]),
    ...(model.page < 4 ? [Button.view({
      onClick: Message.ClickedPage({ page: mutant === 'wiring' ? model.page : model.page + 1 }),
      toView: attributes => h.button([...attributes.button, h.DataAttribute('action', 'next'), h.DataAttribute('expected-page', String(model.page + 1))], ['Next page']),
    }, h)] : []),
  ]),
  h.section([h.AriaLabel('Results'), h.AriaLive('polite')], [
    AsyncData.match(model.result, {
      onIdle: () => h.p([], ['Choose a query or press Refresh.']),
      onLoading: () => h.p([], ['Waiting for a controlled response…']),
      onRefreshing: data => h.ul([], data.items.map(item => h.li([], [item]))),
      onStale: ({ error }) => h.p([h.Role('alert')], [error]),
      onFailure: error => h.p([h.Role('alert')], [error]),
      onSuccess: data => h.ul([], data.items.map(item => h.li([], [item]))),
    }),
  ]),
  h.submodel({ slotId: model.dialog.id, model: model.dialog, toParentMessage: message => Message.GotDialogMessage({ message }), view: Dialog.view, viewInputs: {
    toView: attributes => h.dialog(attributes.dialog, [h.div(attributes.panel, [
      h.h2(attributes.title, ['Request failed']),
      h.p(attributes.description, ['The fixture returned a controlled failure. Retry or dismiss the error.']),
      button(h, 'dismiss', 'Dismiss error', Message.ClickedDismiss()),
      button(h, 'retry', 'Retry request', Message.ClickedRetry()),
    ])]),
  } }),
  h.details([], [h.summary([], ['Current Model']), h.pre([h.Id('model')], [JSON.stringify(model)])]),
])
