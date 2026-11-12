import { test } from 'bun:test'
import { Command, click, expect, given, role, scene, text, type, label } from 'foldkit/scene'
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
