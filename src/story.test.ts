import { Dialog } from '@foldkit/ui'
import { expect, test } from 'bun:test'
import { Command, given, message, model, story } from 'foldkit/story'
import { FetchPage } from './command'
import { Message, getPage, initialModel } from './model'
import { makeUpdate } from './update'
import { Headless, runChoices } from './headless'

const request = { id: 1, query: 'a', page: 1 }
test('search Command succeeds through a matching response', () => {
  story(makeUpdate('clean'), given(initialModel()), message(Message.UpdatedQuery({ query: 'a' })),
    Command.expectExact(FetchPage({ request })),
    Command.resolve(FetchPage, Message.SucceededFetchPage({ request, page: getPage(request) })),
    model(model => { expect(model.result._tag).toBe('Success'); expect(model.pending).toHaveLength(0) }))
})
test('failure opens the real Dialog and dismiss clears its error', () => {
  story(makeUpdate('clean'), given(initialModel()), message(Message.UpdatedQuery({ query: 'a' })),
    Command.resolve(FetchPage, Message.FailedFetchPage({ request, error: 'Controlled failure' })),
    model(model => { expect(model.dialog.isOpen).toBe(true); expect(model.result._tag).toBe('Failure') }),
    Command.resolve(Dialog.ShowDialog, Dialog.Message.SucceededShowDialog()),
    message(Message.ClickedDismiss()),
    Command.resolve(Dialog.CloseDialog, Dialog.Message.CompletedCloseDialog()),
    model(model => { expect(model.dialog.isOpen).toBe(false); expect(model.result._tag).toBe('Idle') }))
})
test('only issued Commands can be settled; logical time gates replies', () => {
  const harness = new Headless('clean')
  expect(() => harness.act('success-oldest')).toThrow('Invalid')
  harness.act('search-a')
  expect(harness.readyIds()).toEqual([])
  harness.act('delay'); harness.act('success-oldest')
  expect(harness.observer.violations).toEqual([])
  expect(harness.pending.size).toBe(0)
})
for (const [mutant, trace, property] of [
  ['stale', ['search-a', 'search-b', 'delay', 'success-oldest'], 'stale_ignored'],
  ['duplicate', ['refresh', 'refresh'], 'no_duplicate_pending'],
  ['recovery', ['refresh', 'delay', 'fail-oldest', 'dismiss'], 'dialog_recovers'],
] as const) test(`${mutant} mutant trips ${property}; clean does not`, () => {
  for (const variant of ['clean', mutant] as const) {
    const harness = new Headless(variant)
    for (const action of trace) harness.act(action)
    expect(harness.observer.violations.includes(property)).toBe(variant !== 'clean')
  }
})
test('headless wiring control cannot observe DOM handlers', () => {
  const result = runChoices('wiring', [5, 0, 4, 1, 5, 8])
  expect(result.harness.observer.violations).toEqual([])
  expect(result.harness.observer.coverage.dom_wiring).toBe(0)
})
