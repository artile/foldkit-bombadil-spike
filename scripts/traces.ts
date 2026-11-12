import { Schema } from 'effect'

const Trace = Schema.Struct({
  timestamp: Schema.Number,
  action: Schema.Unknown,
  snapshots: Schema.Array(Schema.Struct({ index: Schema.Number, value: Schema.Unknown })),
  violations: Schema.Array(Schema.Unknown),
})
const Snapshot = Schema.Struct({
  semanticActions: Schema.Number,
  messages: Schema.Number,
  commands: Schema.Number,
  firstViolationMessage: Schema.Number,
  violations: Schema.Array(Schema.String),
  coverage: Schema.Record(Schema.String, Schema.Number),
  actionCoverage: Schema.Record(Schema.String, Schema.Number),
  model: Schema.Unknown,
})
export const readTrace = async (path: string) => {
  const file = Bun.file(path)
  if (!await file.exists()) return undefined
  const lines = (await file.text()).trim().split('\n').filter(Boolean).map(line => Schema.decodeUnknownSync(Trace)(JSON.parse(line)))
  if (!lines.length) return undefined
  const first = lines[0]!, last = lines.at(-1)!
  const firstViolation = lines.find(line => line.violations.length > 0)
  const snapshots = last.snapshots.find(snapshot => snapshot.index === 0)
  const snapshot = snapshots?.value ? Schema.decodeUnknownSync(Snapshot)(snapshots.value) : undefined
  const actionsToViolation = firstViolation ? lines.slice(0, lines.indexOf(firstViolation) + 1).filter(line => line.action !== null).length : undefined
  return {
    states: lines.length, actions: lines.filter(line => line.action !== null).length,
    first_timestamp_ms: first.timestamp / 1000, useful_ms: (last.timestamp - first.timestamp) / 1000,
    first_violation_useful_ms: firstViolation ? (firstViolation.timestamp - first.timestamp) / 1000 : undefined,
    first_violation_actions: actionsToViolation,
    bombadil_violated: !!firstViolation, snapshot,
  }
}
