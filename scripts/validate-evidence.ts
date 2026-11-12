import assert from 'node:assert/strict'

const root = process.argv[2] ?? 'measurements/2026-11-12-m1max'
const files = await Array.fromAsync(new Bun.Glob('**/*.toml').scan(root))
const rows: Array<Record<string, unknown>> = await Promise.all(files.filter(path => path.endsWith('measurement.toml') || path.startsWith('headless/')).map(async path => ({ ...Bun.TOML.parse(await Bun.file(`${root}/${path}`).text()), path })))
const discovery = rows.filter(row => row.kind === 'discovery')
for (const engine of ['dom', 'direct', 'effect-arbitrary', 'fast-check']) {
  for (const mutant of ['clean', 'stale', 'duplicate', 'recovery', 'wiring']) {
    const group = discovery.filter(row => row.engine === engine && row.mutant === mutant)
    assert.equal(group.length, 5, `${engine}/${mutant}: expected 5 repeats`)
    assert(group.every(row => !['timeout', 'error', 'incomplete'].includes(String(row.status))), `${engine}/${mutant}: run incomplete`)
    const detected = group.filter(row => row.status === 'violation').length
    if (mutant === 'clean' || (mutant === 'wiring' && engine !== 'dom')) assert.equal(detected, 0, `${engine}/${mutant}: negative control failed`)
    else assert(detected > 0, `${engine}/${mutant}: no detection`)
  }
}
const canonical = (input: unknown): string => {
  if (Array.isArray(input)) return `[${input.map(canonical).join(',')}]`
  if (input && typeof input === 'object') return `{${Object.entries(input).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}:${canonical(value)}`).join(',')}}`
  return JSON.stringify(input)
}
const supplement = process.argv[3]
if (supplement) for (const path of await Array.fromAsync(new Bun.Glob('**/measurement.toml').scan(supplement))) rows.push({ ...Bun.TOML.parse(await Bun.file(`${supplement}/${path}`).text()), path: `${supplement}/${path}`, supplement: true })
const fixed = rows.filter(row => row.kind === 'fixed-trace' && (row.engine === 'headless' || !supplement || row.supplement === true))
assert.equal(fixed.length, 15)
const expected = canonical(fixed.find(row => row.engine === 'headless')?.final_model)
for (const row of fixed) {
  assert.equal(row.semantic_actions, 60, `${row.path}: semantic count`)
  assert.equal(row.messages, 40, `${row.path}: Message count`)
  assert.equal(canonical(row.final_model ?? row.model), expected, `${row.path}: final Model`)
  if (row.engine !== 'headless') assert.equal(row.status, 'completed', `${row.path}: missing completion marker`)
}
const headlessReplay = discovery.flatMap(row => Array.isArray(row.replay_success) ? row.replay_success : [])
assert.equal(headlessReplay.length, 90)
assert(headlessReplay.every(value => value === true), 'headless counterexample replay failed')
const browserReplay = rows.filter(row => row.kind === 'replay' || row.kind === 'shrink-replay')
assert(browserReplay.length >= 21, 'missing representative browser replays')
console.log(`Validated ${discovery.length} discovery runs, ${fixed.length} matched traces, ${headlessReplay.length} headless replays. Browser replay results: ${browserReplay.filter(row => row.reproduced).length}/${browserReplay.length}; inspect raw failures rather than hiding them.`)
