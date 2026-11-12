import { AsyncData, Command, Update } from 'foldkit'
import { Dialog } from '@foldkit/ui'
import { FetchPage, Transport } from './command'
import { Message, Model, Mutant, Result } from './model'

type UpdateReturn = Update.Return<Model, Message, Transport>
const dialogCommands = (commands: ReadonlyArray<Command.Command<Dialog.Message>> | undefined) =>
  Command.mapMessages(commands, message => Message.GotDialogMessage({ message }))

const startRequest = (mutant: Mutant, model: Model): UpdateReturn => {
  if (mutant !== 'duplicate' && model.pending.some(request => request.id === model.activeId && request.query === model.query && request.page === model.page)) {
    return { model }
  }
  const request = { id: model.sequence + 1, query: model.query, page: model.page }
  return {
    model: { ...model, sequence: request.id, activeId: request.id, pending: [...model.pending, request], result: Result.Loading() },
    commands: [FetchPage({ request })],
  }
}

const retry = (mutant: Mutant, model: Model): UpdateReturn => {
  const dialogClose = Dialog.close(model.dialog)
  const requestStart = startRequest(mutant, { ...model, dialog: dialogClose.model })
  return { model: requestStart.model, commands: [...(dialogCommands(dialogClose.commands) ?? []), ...(requestStart.commands ?? [])] }
}

export const makeUpdate = (mutant: Mutant) => (model: Model, message: Message) =>
  Message.match<UpdateReturn>(message, {
    UpdatedQuery: ({ query }) => startRequest(mutant, { ...model, query, page: 1 }),
    ClickedPage: ({ page }) => startRequest(mutant, { ...model, page: Math.max(1, Math.min(4, page)) }),
    ClickedRefresh: () => startRequest(mutant, model),
    ClickedRetry: () => retry(mutant, model),
    ClickedDismiss: () => {
      const dialogClose = Dialog.close(model.dialog)
      return {
        model: { ...model, dialog: dialogClose.model, result: mutant === 'recovery' ? model.result : Result.Idle() },
        commands: dialogCommands(dialogClose.commands),
      }
    },
    GotDialogMessage: ({ message }) => {
      const dialogUpdate = Dialog.update(model.dialog, message)
      return { model: { ...model, dialog: dialogUpdate.model }, commands: dialogCommands(dialogUpdate.commands) }
    },
    SucceededFetchPage: ({ request, page }) => {
      const pending = model.pending.filter(item => item.id !== request.id)
      return { model: { ...model, pending, result: request.id === model.activeId || mutant === 'stale' ? Result.Success({ data: page }) : model.result } }
    },
    FailedFetchPage: ({ request, error }) => {
      const pending = model.pending.filter(item => item.id !== request.id)
      if (request.id !== model.activeId) return { model: { ...model, pending } }
      const dialogOpen = Dialog.open(model.dialog)
      return { model: { ...model, pending, result: Result.Failure({ error }), dialog: dialogOpen.model }, commands: dialogCommands(dialogOpen.commands) }
    },
  })

export const hasError = (model: Model) => AsyncData.hasError(model.result)
