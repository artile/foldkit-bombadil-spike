import { test } from 'bun:test'
import { Command, click, expect, given, role, scene, text, type, label, Mount } from 'foldkit/scene'
import { FetchPage } from './command'
import { Message, getPage, initialModel } from './model'
import { makeUpdate } from './update'
import { makeView } from './view'

const request = { id: 1, query: 'a', page: 1 }
test('typing, loading, and successful catalogue data render through Foldkit Scene', () => {
  scene({ update: makeUpdate('clean'), view: makeView('clean') }, given(initialModel()),
    expect(role('heading', { name: 'Foldkit catalogue' })).toExist(),
    type(label('Search catalogue'), 'a'),
    expect(text('Waiting for a controlled response…')).toExist(),
    Command.resolve(FetchPage, Message.SucceededFetchPage({ request, page: getPage(request) })),
    expect(text('Amber lamp')).toExist())
})
test('Next page DOM handler produces the intended Command', () => {
  scene({ update: makeUpdate('clean'), view: makeView('clean') }, given(initialModel()),
    click(role('button', { name: 'Next page' })),
    expect(text('Page 2')).toExist(),
    Command.expectExact(FetchPage({ request: { id: 1, query: '', page: 2 } })),
    Command.resolve(FetchPage, Message.SucceededFetchPage({ request: { id: 1, query: '', page: 2 }, page: getPage({ id: 1, query: '', page: 2 }) })))
})
test('empty search results render an empty list', () => {
  const request = { id: 1, query: 'xyz', page: 1 }
  scene({ update: makeUpdate('clean'), view: makeView('clean') }, given(initialModel()),
    type(label('Search catalogue'), 'xyz'),
    Command.resolve(FetchPage, Message.SucceededFetchPage({ request, page: getPage(request) })),
    expect(role('list')).toExist(), expect(role('listitem')).toBeAbsent())
})

test('controlled failure renders an alert and the error Dialog; dismiss restores idle', async () => {
  const { Dialog } = await import('@foldkit/ui')
  scene({ update: makeUpdate('clean'), view: makeView('clean') }, given(initialModel()),
    type(label('Search catalogue'), 'a'),
    Command.resolve(FetchPage, Message.FailedFetchPage({ request, error: 'Controlled failure' })),
    Command.resolve(Dialog.ShowDialog, Dialog.Message.SucceededShowDialog()),
    Mount.resolve(Dialog.AcquireResources, Dialog.Message.SucceededAcquireResources()),
    expect(role('alert')).toExist(),
    expect(role('heading', { name: 'Request failed' })).toExist(),
    click(role('button', { name: 'Dismiss error' })),
    Command.resolve(Dialog.CloseDialog, Dialog.Message.CompletedCloseDialog()),
    Mount.expectEnded(Dialog.AcquireResources),
    expect(role('alert')).toBeAbsent(),
    expect(text('Choose a query or press Refresh.')).toExist())
})
