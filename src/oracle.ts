import { Schema } from 'effect'
import { AsyncData } from 'foldkit'
import type { Command } from 'foldkit'
import { Message, Model, Request, getPage } from './model'

export const propertyNames = ['response_matches_pending', 'stale_ignored', 'no_duplicate_pending', 'dialog_recovers', 'page_data_matches', 'dom_wiring']
export type Coverage = Record<string, number>

// This is a test observer, outside Model/update/view. Each transition is audited,
// including Command replies between Bombadil's settled observations.
export class Observer {
  violations: Array<string> = []
  coverage: Coverage = Object.fromEntries(propertyNames.map(name => [name, 0]))
  messages = 0
  commands = 0
  firstViolationMessage = 0
  tags: Record<string, number> = {}
  expectedPage: number | undefined
  model: Model
  constructor(initial: Model) { this.model = initial }
  check(name: string, condition: boolean) {
    this.coverage[name] = (this.coverage[name] ?? 0) + 1
    if (!condition && !this.violations.includes(name)) {
      this.violations.push(name)
      if (!this.firstViolationMessage) this.firstViolationMessage = this.messages
    }
  }
  observe(before: Model, message: Message, after: Model, commands: ReadonlyArray<Command.Command<Message, never, unknown>>) {
    this.messages++
    this.tags[message._tag] = (this.tags[message._tag] ?? 0) + 1
    this.commands += commands.filter(command => command.name === 'FetchPage').length
    if (message._tag === 'SucceededFetchPage' || message._tag === 'FailedFetchPage') {
      this.check('response_matches_pending', before.pending.some(request => request.id === message.request.id && request.query === message.request.query && request.page === message.request.page))
      if (message.request.id !== before.activeId) this.check('stale_ignored', JSON.stringify(before.result) === JSON.stringify(after.result))
    }
    // Superseded requests for the same query/page are legitimate after A -> B -> A.
    // Only issuing again while that exact active request is pending is a duplicate.
    if (before.pending.some(request => request.id === before.activeId && request.query === after.query && request.page === after.page)) {
      this.check('no_duplicate_pending', !commands.some(command => command.name === 'FetchPage'))
    }
    if (message._tag === 'ClickedDismiss' && AsyncData.hasError(before.result)) this.check('dialog_recovers', !AsyncData.hasError(after.result) && !after.dialog.isOpen)
    if (AsyncData.isSuccess(after.result)) {
      const data = after.result.data
      this.check('page_data_matches', data.request.id === after.activeId && data.total === getPage(data.request).total && data.items.join('|') === getPage(data.request).items.join('|'))
    }
    if (message._tag === 'ClickedPage' && this.expectedPage !== undefined) {
      this.check('dom_wiring', message.page === this.expectedPage)
      this.expectedPage = undefined
    }
    this.checkBounds(after)
    this.model = after
  }
  private checkBounds(model: Model) {
    if (model.page < 1 || model.page > 4) throw new Error('page outside catalogue bounds')
  }
  snapshot() {
    return { model: this.model, violations: this.violations, coverage: this.coverage, messages: this.messages, commands: this.commands, tags: this.tags, firstViolationMessage: this.firstViolationMessage }
  }
}

export const requestFromCommand = (command: Command.Command<Message, never, unknown>): Request | undefined =>
  command.name === 'FetchPage' ? Schema.decodeUnknownSync(Request)(command.args?.request) : undefined
