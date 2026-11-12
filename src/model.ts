import { Schema } from 'effect'
import { AsyncData } from 'foldkit'
import { Dialog } from '@foldkit/ui'
import { defineMessageUnion } from 'foldkit/message'

export const Request = Schema.Struct({ id: Schema.Number, query: Schema.String, page: Schema.Number })
export type Request = typeof Request.Type
export const Page = Schema.Struct({ request: Request, items: Schema.Array(Schema.String), total: Schema.Number })
export type Page = typeof Page.Type
export const Result = AsyncData.Schema(Page, Schema.String)
export const Model = Schema.Struct({
  query: Schema.String,
  page: Schema.Number,
  sequence: Schema.Number,
  activeId: Schema.Number,
  pending: Schema.Array(Request),
  result: Result.schema,
  dialog: Dialog.Model,
})
export type Model = typeof Model.Type
export const Message = defineMessageUnion({
  UpdatedQuery: { query: Schema.String },
  ClickedPage: { page: Schema.Number },
  ClickedRefresh: {},
  ClickedDismiss: {},
  ClickedRetry: {},
  GotDialogMessage: { message: Dialog.Message },
  SucceededFetchPage: { request: Request, page: Page },
  FailedFetchPage: { request: Request, error: Schema.String },
})
export type Message = typeof Message.Type
export type Reply = Extract<Message, { _tag: 'SucceededFetchPage' | 'FailedFetchPage' }>
export const Mutant = Schema.Literals(['clean', 'stale', 'duplicate', 'recovery', 'wiring'])
export type Mutant = typeof Mutant.Type
export const initialModel = (): Model => ({
  query: '', page: 1, sequence: 0, activeId: 0, pending: [],
  result: Result.Idle(), dialog: Dialog.init({ id: 'request-error' }),
})

export const catalogue = [
  'Amber lamp', 'Azure cup', 'Birch chair', 'Blue bowl',
  'Cedar table', 'Copper clock', 'Dune rug', 'Elm shelf',
  'Fern pot', 'Gold frame', 'Indigo vase', 'Jade plate',
]
export const PAGE_SIZE = 3
export const getPage = (request: Request): Page => {
  const filtered = catalogue.filter(item => item.toLowerCase().includes(request.query.toLowerCase()))
  return { request, total: filtered.length, items: filtered.slice((request.page - 1) * PAGE_SIZE, request.page * PAGE_SIZE) }
}
