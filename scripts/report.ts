import { mkdir } from 'node:fs/promises'
import { writeToml } from './data'

const root = process.argv[2] ?? 'measurements/2026-11-12-m1max'
const record = (input: unknown): Record<string, unknown> => {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new Error('Expected record')
  return Object.fromEntries(Object.entries(input))
}
const string = (row: Record<string, unknown>, key: string) => typeof row[key] === 'string' ? String(row[key]) : ''
const number = (row: Record<string, unknown>, key: string) => typeof row[key] === 'number' ? Number(row[key]) : undefined
const median = (values: Array<number>) => {
  const sorted = [...values].sort((left, right) => left - right)
  if (!sorted.length) return 0
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2
}
const numbers = (rows: Array<Record<string, unknown>>, key: string) => rows.flatMap(row => number(row, key) === undefined ? [] : [number(row, key)!])
const format = (value: number, digits = 2) => value.toFixed(digits)
const canonical = (input: unknown): string => {
  if (Array.isArray(input)) return `[${input.map(canonical).join(',')}]`
  if (input && typeof input === 'object') return `{${Object.entries(input).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}:${canonical(value)}`).join(',')}}`
  return JSON.stringify(input)
}
const sources = [root, ...process.argv.slice(3)]
const rows: Array<Record<string, unknown>> = []
for (const source of sources) {
  const files = (await Array.fromAsync(new Bun.Glob('**/*.toml').scan(source))).sort()
  for (const path of files.filter(path => path !== 'environment.toml' && path !== 'summary.toml')) {
    rows.push({ ...record(Bun.TOML.parse(await Bun.file(`${source}/${path}`).text())), path: `${source}/${path}`, source })
  }
}
const environment = record(Bun.TOML.parse(await Bun.file(`${root}/environment.toml`).text()))
const browserFile = Bun.file(`${root}/browser-version.toml`)
const browserMetadata = await browserFile.exists() ? record(Bun.TOML.parse(await browserFile.text())) : {}
const browserDescription = browserMetadata.version ? `Full installed Chrome version ${browserMetadata.version}, checked from the executable used by Bombadil, is in browser-version.toml; navigator.userAgent is reduced.` : 'Each browser trace records navigator.userAgent, which may be version-reduced; the full executable version was not recorded in this run.'
const engines = ['dom', 'direct', 'effect-arbitrary', 'fast-check']
const mutants = ['clean', 'stale', 'duplicate', 'recovery', 'wiring']
const discovery = rows.filter(row => string(row, 'kind') === 'discovery')
const allFixed = rows.filter(row => string(row, 'kind') === 'fixed-trace')
const fixed = allFixed.filter(row => string(row, 'engine') === 'headless' || row.source === (sources[1] ?? root))
const expectedModel = fixed.find(row => string(row, 'engine') === 'headless')?.final_model
const summaries = engines.map(engine => ({
  engine,
  detection: Object.fromEntries(mutants.map(mutant => {
    const group = discovery.filter(row => string(row, 'engine') === engine && string(row, 'mutant') === mutant)
    return [mutant, { detected: group.filter(row => string(row, 'status') === 'violation').length, total: group.length, errors: group.filter(row => ['timeout', 'error', 'incomplete'].includes(string(row, 'status'))).length }]
  })),
}))
const fixedSummary = ['dom', 'direct', 'headless'].map(engine => {
  const group = fixed.filter(row => string(row, 'engine') === engine)
  const times = numbers(group, engine === 'headless' ? 'elapsed_ms' : 'useful_ms')
  return {
    engine, repeats: group.length, median_useful_ms: median(times), minimum_useful_ms: Math.min(...times), maximum_useful_ms: Math.max(...times),
    median_actions_per_second: median(times.map(time => 60 / (time / 1000))),
    median_wall_ms: engine === 'headless' ? undefined : median(numbers(group, 'elapsed_ms')),
    median_startup_ms: engine === 'headless' ? undefined : median(numbers(group, 'startup_to_first_snapshot_ms')),
    complete: group.every(row => number(row, 'semantic_actions') === 60 && number(row, 'messages') === 40 && (engine === 'headless' || string(row, 'status') === 'completed')),
    same_final_model: group.every(row => canonical(row.final_model ?? row.model) === canonical(expectedModel)),
  }
})
const domFixed = fixedSummary.find(group => group.engine === 'dom')!
const directFixed = fixedSummary.find(group => group.engine === 'direct')!
const ratio = directFixed.median_useful_ms / domFixed.median_useful_ms
const replays = rows.filter(row => ['replay', 'shrink-replay'].includes(string(row, 'kind')))
const shrinks = rows.filter(row => string(row, 'kind') === 'shrink')
const coverage = engines.map(engine => {
  const group = discovery.filter(row => string(row, 'engine') === engine && string(row, 'mutant') === 'clean')
  const totals: Record<string, number> = {}
  const actionTotals: Record<string, number> = {}
  for (const row of group) {
    for (const [key, value] of Object.entries(record(row.coverage ?? row.trigger_coverage_including_shrink ?? {}))) if (typeof value === 'number') totals[key] = (totals[key] ?? 0) + value
    for (const [key, value] of Object.entries(record(row.actionCoverage ?? row.action_coverage_including_shrink ?? {}))) if (typeof value === 'number') actionTotals[key] = (actionTotals[key] ?? 0) + value
  }
  return { engine, triggers: totals, actions: actionTotals }
})
await writeToml(`${root}/summary.toml`, {
  source_commit: environment.source_commit, evidence_sources: sources, discovery: summaries, fixed_trace: fixedSummary,
  replay_success: replays.filter(row => row.reproduced === true).length, replay_total: replays.length, shrink: shrinks,
  clean_control_coverage: coverage,
})
const detectionTable = summaries.map(summary => `| ${summary.engine} | ${mutants.map(mutant => { const group = summary.detection[mutant]!; return `${group.detected}/${group.total}${group.errors ? ` (${group.errors} errors)` : ''}` }).join(' | ')} |`).join('\n')
const speedTable = fixedSummary.map(group => `| ${group.engine} | ${group.repeats} | ${format(group.median_useful_ms)} (${format(group.minimum_useful_ms)}–${format(group.maximum_useful_ms)}) | ${format(group.median_actions_per_second)} | ${group.median_wall_ms === undefined ? 'not measured' : format(group.median_wall_ms)} | ${group.median_startup_ms === undefined ? 'not measured' : format(group.median_startup_ms)} | ${group.complete && group.same_final_model ? 'yes' : 'INCOMPLETE/MISMATCH'} |`).join('\n')
const detectionTimeTable = engines.flatMap(engine => mutants.filter(mutant => mutant !== 'clean').map(mutant => {
  const group = discovery.filter(row => string(row, 'engine') === engine && string(row, 'mutant') === mutant && string(row, 'status') === 'violation')
  if (!group.length) return `| ${engine} | ${mutant} | — | — | — |`
  const browser = engine === 'dom' || engine === 'direct'
  return `| ${engine} | ${mutant} | ${group.length}/5 | ${format(median(numbers(group, browser ? 'first_violation_useful_ms' : 'first_violation_ms')))} | ${format(median(numbers(group, browser ? 'first_violation_actions' : 'first_violation_cumulative_actions')), 0)} |`
})).join('\n')
const cleanTable = engines.map(engine => {
  const group = discovery.filter(row => string(row, 'engine') === engine && string(row, 'mutant') === 'clean')
  const browser = engine === 'dom' || engine === 'direct'
  return `| ${engine} | ${format(median(numbers(group, browser ? 'actions_per_useful_second' : 'actions_per_second_including_shrink')))} | ${browser ? format(median(numbers(group, 'states_per_useful_second'))) : 'not a browser state'} | ${browser ? format(median(numbers(group, 'startup_to_first_snapshot_ms'))) : 'not measured'} |`
}).join('\n')
const coverageTable = coverage.map(group => `| ${group.engine} | ${['response_matches_pending', 'stale_ignored', 'no_duplicate_pending', 'dialog_recovers', 'page_data_matches', 'dom_wiring'].map(key => group.triggers[key] ?? 0).join(' | ')} |`).join('\n')
const shrinkTable = shrinks.map(row => `| ${string(row, 'path').includes('direct') ? 'direct' : 'DOM'} | ${row.before_actions} | ${row.after_actions ?? 'not produced'} | ${format(number(row, 'elapsed_ms') ?? 0)} | ${row.retained_violation} |`).join('\n')
const headlessShrinkTable = engines.filter(engine => engine !== 'dom' && engine !== 'direct').flatMap(engine => ['stale', 'duplicate', 'recovery'].map(mutant => {
  const group = discovery.filter(row => string(row, 'engine') === engine && string(row, 'mutant') === mutant)
  return `| ${engine} | ${mutant} | ${format(median(numbers(group, 'before_actions')), 0)} | ${format(median(numbers(group, 'after_actions')), 0)} | ${format(median(numbers(group, 'shrink_and_return_ms')))} |`
})).join('\n')
const headlessReplay = discovery.filter(row => Array.isArray(row.replay_success)).flatMap(row => Array.isArray(row.replay_success) ? row.replay_success : [])
await mkdir('report', { recursive: true })
const markdown = `# Foldkit Messages through Bombadil custom actions\n\nThis run uses source commit \`${environment.source_commit}\`, Foldkit 0.170.0, Effect / platform-browser 4.1.0, Bombadil 0.7.10 and fast-check 4.8.0. Host: ${environment.cpu}, ${environment.platform} ${environment.arch}, ${environment.logical_cpus} logical CPUs, Bun ${environment.bun}. ${browserDescription}\n\n## What the PoC proves\n\nBombadil custom actions can feed user Messages into a real Foldkit browser runtime through a public inbound Port. The bridge calls \`Runtime.embed(element).ports.testMessage.send(message)\`; \`Port.subscriptionEntry\` feeds the runtime's Message loop. The bridge never calls update. Real Commands wait in a controlled Effect transport and return their own matching Succeeded/Failed Message. Browser view patches and the real Foldkit Dialog run in both browser paths.\n\nHeadless testing deliberately calls the same pure update and interprets its Command descriptors. It simulates successful native Dialog effects. It does not run Foldkit's browser runtime, DOM, focus trap, Mount lifecycle, or browser event mapping.\n\n## Mutant discovery\n\nEach cell is detections / runs, not a coverage claim. Clean and the wiring blind spots are negative controls. Browser runs have a 15-second CLI limit and stop at the first violation. The CLI limit includes some startup; observed useful time is recorded separately. There is no invented Bombadil seed or action-limit option. Headless engines use seeds 1001–1005, 1,000 cases per seed, and traces up to 80 valid semantic actions. Different discovery algorithms and length distributions prevent a fair speed ranking from this table.\n\n| Engine | Clean | Stale response | Duplicate pending | Dialog recovery | DOM wiring |\n|---|---:|---:|---:|---:|---:|\n${detectionTable}\n\nThe wiring mutant changes the Next page button's Foldkit OnClick Message. A separate test-only DOM capture observer records the control's declared intended page before Foldkit handles the click. Direct Port sends and headless calls skip that observer, so their zero wiring detections are expected. This is one explicit wiring check, not a proof of all DOM wiring.\n\n| Engine | Mutant | Detected | Median time to violation (ms) | Median cumulative actions to violation |\n|---|---|---:|---:|---:|\n${detectionTimeTable}\n\nBrowser time starts at its first state snapshot; headless time starts before generation and includes earlier passing cases. Headless cumulative actions include all earlier cases, while browser actions belong to one uninterrupted run. The two columns therefore describe each engine and are not matched discovery work. Original failing trace lengths are stored separately.\n\n## Same semantic trace\n\n${sources.length > 1 ? `The initial 15-second fixed-trace series completed ${allFixed.filter(row => row.source === root && row.engine !== 'headless' && row.status === 'completed').length}/10 browser runs. All original attempts remain in the main evidence directory. A follow-up repeated ALL ten browser comparisons at 30 seconds; the table below uses that complete follow-up, with the same 60-action trace and original warm headless measurements. This avoids selecting only successful original attempts. Follow-up source/config: ${sources[1]}/environment.toml. ` : ''}Each repeat targets exactly 60 semantic actions, observes 40 application Messages, issues 20 FetchPage Commands, and ends at the same Model. Every action is issued separately. Delay is one logical-clock action and emits no Message; each reply settles one already-issued Command. No 100-Message batch is counted as one action. The browser specs use an explicit \`traceComplete\` stop property after action 60; that deliberate stop is excluded from bug detection counts.\n\n| Engine | Repeats | Median useful ms (min–max) | Semantic actions/s | Median wall ms | Median startup-to-first-snapshot ms | Complete and same final Model |\n|---|---:|---:|---:|---:|---:|---|\n${speedTable}\n\n![Same-trace elapsed times on a log scale](fixed-trace.svg)\n\nBrowser useful time includes Bombadil action selection, Chromium input/custom-action execution, runtime work, rendering, instrumented coverage collection, extractors and screenshot capture. Custom actions also wait for bridge acknowledgement and render convergence. Headless time is warm in-process update + test interpreter + oracle only. This is a cost-of-exercised-layers comparison, not a claim that one discovery algorithm is better or that direct dispatch replaces DOM tests. Tiny headless timings have coarse relative resolution; no cross-machine claim follows.\n\nClean discovery throughput (descriptive only):\n\n| Engine | Median semantic actions/s | Median snapshots/s | Median startup ms |\n|---|---:|---:|---:|\n${cleanTable}\n\n## Trigger coverage\n\nCounts below sum the five clean discovery runs. They count precondition-triggered checks, not distinct states or exhaustive coverage. Runtime checks latch violations on every observed update transition, including reply Messages between Bombadil snapshots. Native Dialog Mount cleanup Messages may differ from the explicit headless interpreter and are not claimed equivalent. Page data checks only run on Success; stale checks only on superseded replies; recovery checks only on dismissal after failure. The fixed speed trace deliberately has no failure branch and is not a coverage test.\n\n| Engine | Reply pending | Stale ignored | Pending guard | Recovery | Page data | DOM wiring |\n|---|---:|---:|---:|---:|---:|---:|\n${coverageTable}\n\nThe summary TOML also includes per-action coverage. Search discovery uses the same three query presets (all/a/b), page controls, refresh, logical delay, oldest/newest success/failure, dismiss and retry. The text input supports arbitrary search and has a Scene test, but random browser benchmarks restrict their actions to these matched presets.\n\n## Shrinking and replay\n\nBrowser representatives: ${replays.filter(row => row.reproduced === true).length}/${replays.length} replay attempts reproduced a latched model/wiring violation, including shrunk-trace replays where available. Each representative gets three attempts. No replay success is inferred from exit status alone.\n\n| Browser path (stale mutant) | Before actions | After actions | Shrink wall ms | Retained violation |\n|---|---:|---:|---:|---|\n${shrinkTable}\n\nBombadil shrinking is experimental and gets a 20-second CLI limit. Calibration and confirmation can consume most of that time; wall elapsed is recorded. Logs show any timeout, replay divergence, or failure. Full original and shrunk JSONL traces stay byte-for-byte as Bombadil wrote them. Screenshots/downloads are omitted; JSONL image references are therefore not shipped.\n\n| Headless engine | Mutant | Median before actions | Median after actions | Median shrink-and-return ms |\n|---|---|---:|---:|---:|\n${headlessShrinkTable}\n\nNative/fast-check counterexample replay: ${headlessReplay.filter(value => value === true).length}/${headlessReplay.length}. Native Effect Arbitrary records its own seed, initial input, shrunk input and replay token. fast-check records its seed/path, first failing semantic trace and final counterexample; its first raw choice vector is not exposed by this runner. Shrink timing is elapsed after the first failure through check return, so it includes result assembly. Shrinking can change the valid-action mapping as prior actions disappear; every candidate is interpreted anew and must still fail.\n\n## Conclusions\n\nThe runtime seam works with stock Foldkit and Bombadil, without a framework patch. On the matched trace, the direct/DOM median useful-time ratio is ${format(ratio)}; this small shared-host sample does not establish a general speed advantage. The useful difference is control over valid Messages and response ordering. Keep DOM checks for input wiring and native interaction, direct browser checks for runtime/Command/render behavior, and native Arbitrary for large transition searches and shrinking.\n\n## Controls and limits\n\n- The server binds only 127.0.0.1. There is no vendor API, account, secret, product code or customer data. A fixed 12-item catalogue is the only data. CSP permits only local script/network resources. Dependencies/Chrome setup may require downloads before testing.\n- Every browser run uses a fresh browser/document and initial Model. This resets request ids, the response queue, logical clock, oracle and action counters. No random response timing or wall-clock delay controls the app. Headless starts a new interpreter per generated case.\n- Pending replies correspond to real Command descriptors/continuations. Search changes may supersede an earlier request; old responses can still arrive, and the stale oracle checks that they do not change the current result.\n- The measured series predates a final Dialog panel CSS repair. For exact timing/discovery reproduction use the source commits in each environment file. A separate final-recovery evidence directory tests the final presentation with a deterministic four-action clean/mutant trace on both browser paths; it is not used for speed statistics.\n- The bridge is emitted only in the test build. The production entry has no window bridge, inbound test subscription or transport controls. It remains a fixture with no live backend.\n- In the initial runner, stdout/stderr opened the same log path separately. The direct shrink error overwrote part of its stdout text. The later runner uses one shared file descriptor; the original JSONL traces and measurement TOML are unaffected.\n- Five serial repeats are a small sample on a shared laptop. Run order alternates DOM/direct. There are no confidence intervals, dedicated-host isolation, independent Bombadil seeds, byte-identical browser RNG, or claims of complete state/Message coverage.\n- Headless setup/import startup is not separately measured. Chrome-tree CPU/RSS, energy, cloud cost and human authoring time are not measured. No dollar-cost claim is made. Hegel is not evaluated.\n- The live bridge waits for the rendered Model snapshot to converge. That is not a proof that every visible list, label or native interaction matches the Model; Scene tests and the wiring control check selected UI behavior.\n- Direct dispatch validates model/runtime/Command behavior on this semantic action set. DOM tests add event wiring and browser input. Headless tests provide many cheap transition checks and shrinkable traces, while replacing platform effects. Keep the three roles distinct.\n\n## Evidence and reproduction\n\nRaw evidence: ${sources.map(source => `[\`${source}\`](../${source}/)`).join(', ')}. [Summary TOML](../${root}/summary.toml), environment, per-run TOML, process logs and untouched Bombadil trace JSONL are committed. Run \`mise exec -- bun scripts/report.ts ${sources.join(' ')}\` to rebuild this report and its chart from raw evidence. See [README](../README.md) for clean setup and fresh benchmarks.\n`
await Bun.write('report/RESULTS.md', markdown)
const maxLog = Math.max(...fixedSummary.map(group => Math.log10(Math.max(group.median_useful_ms, 0.001))))
const minLog = -1
const bars = fixedSummary.map((group, index) => {
  const y = 70 + index * 65
  const width = Math.max(2, (Math.log10(Math.max(group.median_useful_ms, 0.001)) - minLog) / (maxLog - minLog) * 400)
  return `<text x="20" y="${y + 18}" font-size="15">${group.engine}</text><rect x="140" y="${y}" width="${width}" height="28" fill="${['#3872b7', '#27877e', '#9d5b29'][index]}"/><text x="${150 + width}" y="${y + 19}" font-size="14">${format(group.median_useful_ms)} ms</text>`
}).join('')
const ticks = [-1, 0, 1, 2, 3, 4].filter(tick => tick <= Math.ceil(maxLog)).map(tick => {
  const x = 140 + (tick - minLog) / (maxLog - minLog) * 400
  if (x > 560) return ''
  return `<line x1="${x}" y1="63" x2="${x}" y2="259" stroke="#ccd5df" stroke-dasharray="3 4"/><text x="${x}" y="278" text-anchor="middle" font-size="11">${10 ** tick}</text>`
}).join('')
await Bun.write('report/fixed-trace.svg', `<svg xmlns="http://www.w3.org/2000/svg" width="740" height="320" viewBox="0 0 740 320"><rect width="740" height="320" fill="#f6f8fb"/><g font-family="system-ui,sans-serif" fill="#182535"><text x="20" y="30" font-size="18" font-weight="600">60 semantic actions: median elapsed time</text><text x="20" y="51" font-size="12">Log scale; 5 repeats. Browser useful time vs warm headless loop.</text>${ticks}${bars}<text x="140" y="306" font-size="12">Bar scale starts at 0.1 ms; see table for exact ranges and layer costs.</text></g></svg>`)
console.log(`Rebuilt report/RESULTS.md and ${root}/summary.toml`)
