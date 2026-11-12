import { Context, Effect } from 'effect'
import { Command } from 'foldkit'
import { Message, Request, Reply } from './model'

export class Transport extends Context.Service<Transport, {
  readonly wait: (request: Request) => Effect.Effect<Reply>
}>()('spike/Transport') {}

export const FetchPage = Command.define('FetchPage', {
  args: { request: Request },
  messages: [Message.SucceededFetchPage, Message.FailedFetchPage],
  execute: ({ request }) => Effect.flatMap(Transport, transport => transport.wait(request)),
})
