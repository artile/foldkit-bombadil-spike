import { createHash } from 'node:crypto'
import { closeSync, openSync } from 'node:fs'
import { copyFile, mkdir, rm } from 'node:fs/promises'
import { arch, cpus, platform, release } from 'node:os'
import { resolve } from 'node:path'
import { Mutant } from '../src/model'
import { writeToml } from './data'
import { headlessBench } from './headless-benchmark'
import { readTrace } from './traces'

const root = process.argv[2] ?? `measurements/${new Date().toISOString().replaceAll(':', '-').slice(0, 19)}`
if (await Bun.file(`${root}/environment.toml`).exists()) throw new Error('Use a fresh output directory; measurements are immutable')
await mkdir(root, { recursive: true })
const binary = resolve(process.env.BOMBADIL ?? `node_modules/@antithesishq/bombadil/binaries/bombadil-${platform()}-${arch()}`)
const commandText = (args: Array<string>) => Bun.spawnSync(args, { stdout: 'pipe', stderr: 'pipe' }).stdout.toString().trim()
const codeSha = commandText(['git', 'rev-parse', 'HEAD'])
if (commandText(['git', 'status', '--porcelain'])) throw new Error('Commit benchmark code before recording evidence')
await writeToml(`${root}/environment.toml`, {
  recorded_at: new Date().toISOString(), source_commit: codeSha, platform: platform(), arch: arch(), os_release: release(),
  cpu: cpus()[0]?.model, logical_cpus: cpus().length, bun: Bun.version,
  bombadil: commandText([binary, '--version']), bombadil_sha256: createHash('sha256').update(await Bun.file(binary).arrayBuffer().then(value => new Uint8Array(value))).digest('hex'),
  foldkit: '0.170.0', effect: '4.1.0', platform_browser: '4.1.0', fast_check: '4.8.0',
  lockfile_sha256: createHash('sha256').update(await Bun.file('bun.lock').text()).digest('hex'),
  browser_budget_seconds: 15, browser_repeats: 5, headless_runs_per_seed: 1000, headless_seeds: [1001, 1002, 1003, 1004, 1005],
  width: 1024, height: 768, instrumentation: 'files,inline (Bombadil default)', virtual_time: 'not enabled',
  memory_cpu_scope: 'not measured; Chrome startup, instrumentation and process tree make naive RSS/CPU comparisons misleading',
  initial_data: '12 fixed catalogue items; empty query; page 1; no pending request; logical tick 0',
})

const server = Bun.spawn([process.execPath, 'scripts/server.ts'], { env: { ...process.env, PORT: '4173' }, stdout: 'ignore', stderr: 'inherit' })
const waitReady = async () => {
  const deadline = performance.now() + 10000
  for (;;) {
    if (server.exitCode !== null) throw new Error('Fixture server exited (port already in use?)')
    try { if ((await fetch('http://127.0.0.1:4173')).ok) return } catch {}
    if (performance.now() > deadline) throw new Error('Server startup timeout')
    await new Promise(resolve => setTimeout(resolve, 100))
  }
}
const runProcess = async (args: Array<string>, log: string, timeout = 60000) => {
  const startedAt = Date.now(), start = performance.now()
  const logFd = openSync(log, 'w')
  const process = Bun.spawn(args, { stdout: logFd, stderr: logFd, env: { ...Bun.env, NO_COLOR: '1' } })
  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; process.kill('SIGTERM') }, timeout)
  try { const exit = await process.exited; return { exit, timed_out: timedOut, elapsed_ms: performance.now() - start, started_at_ms: startedAt } }
  finally { clearTimeout(timer); closeSync(logFd) }
}
const browserRun = async (engine: 'dom' | 'direct', mutant: Mutant, repeat: number, fixed = false) => {
  const id = `${fixed ? 'fixed' : 'discovery'}-${engine}-${mutant}-${repeat}`
  const dir = `${root}/browser/${id}`
  await mkdir(dir, { recursive: true })
  const spec = `spec/${fixed ? 'trace-' : ''}${engine}.ts`
  const url = `http://127.0.0.1:4173/?mutant=${mutant}`
  const args = [binary, 'browser', 'test', url, spec, '--headless', '--time-limit', '15s', '--exit-on-violation', '--output-path', dir]
  const run = await runProcess(args, `${dir}/process.log`)
  const trace = await readTrace(`${dir}/trace.jsonl`)
  const snapshot = trace?.snapshot
  const status = run.timed_out ? 'timeout' : !trace ? 'incomplete' : (snapshot?.violations.length || 0) > 0 ? 'violation' : fixed && (snapshot?.semanticActions ?? 0) >= 60 ? 'completed' : run.exit === 0 ? 'time-limit-clean' : 'error'
  await writeToml(`${dir}/measurement.toml`, {
    kind: fixed ? 'fixed-trace' : 'discovery', engine, mutant, repeat, status, command: args.slice(1), ...run,
    states: trace?.states, actions: trace?.actions, semantic_actions: snapshot?.semanticActions, messages: snapshot?.messages,
    startup_to_first_snapshot_ms: trace ? trace.first_timestamp_ms - run.started_at_ms : undefined, useful_ms: trace?.useful_ms,
    actions_per_useful_second: trace ? trace.actions / (trace.useful_ms / 1000) : undefined,
    states_per_useful_second: trace ? trace.states / (trace.useful_ms / 1000) : undefined,
    messages_per_useful_second: trace && snapshot ? snapshot.messages / (trace.useful_ms / 1000) : undefined,
    first_violation_useful_ms: status === 'violation' ? trace?.first_violation_useful_ms : undefined,
    first_violation_actions: status === 'violation' ? trace?.first_violation_actions : undefined,
    ...snapshot,
  })
  // Preserve original JSONL byte-for-byte. Omit only screenshots/downloads.
  await rm(`${dir}/screenshots`, { recursive: true, force: true })
  await rm(`${dir}/downloads`, { recursive: true, force: true })
  console.log(`${id}: ${status}, ${trace?.actions ?? 0} actions, ${run.elapsed_ms.toFixed(0)}ms wall`)
  return { dir, spec, url, status }
}
try {
  await waitReady()
  await headlessBench(root)
  const representatives: Array<Awaited<ReturnType<typeof browserRun>>> = []
  // Alternate order per repeat; all runs are serial on this host.
  for (let repeat = 1; repeat <= 5; repeat++) {
    const engines = repeat % 2 ? ['dom', 'direct'] as const : ['direct', 'dom'] as const
    for (const mutant of Mutant.literals) for (const engine of engines) {
      const run = await browserRun(engine, mutant, repeat)
      if (run.status === 'violation' && !representatives.some(previous => previous.spec === run.spec && previous.url === run.url)) representatives.push(run)
    }
    for (const engine of engines) await browserRun(engine, 'clean', repeat, true)
  }
  for (const representative of representatives) {
    for (let repeat = 1; repeat <= 3; repeat++) {
      const dir = `${representative.dir}/replay-${repeat}`
      await mkdir(dir, { recursive: true })
      const run = await runProcess([binary, 'browser', 'test', representative.url, representative.spec, '--headless', '--reproduce', representative.dir, '--output-path', dir], `${dir}/process.log`)
      const trace = await readTrace(`${dir}/trace.jsonl`)
      await writeToml(`${dir}/measurement.toml`, { kind: 'replay', ...run, reproduced: !!trace?.snapshot?.violations.length, violations: trace?.snapshot?.violations, actions: trace?.actions })
      await rm(`${dir}/screenshots`, { recursive: true, force: true }); await rm(`${dir}/downloads`, { recursive: true, force: true })
    }
  }
  for (const representative of representatives.filter(run => run.url.includes('mutant=stale'))) {
    const dir = `${representative.dir}/shrink`
    await mkdir(dir, { recursive: true })
    const before = await readTrace(`${representative.dir}/trace.jsonl`)
    const run = await runProcess([binary, 'browser', 'shrink', representative.url, representative.spec, '--headless', '--trace', representative.dir, '--property', 'properties', '--time-limit', '20s', '--calibration-runs', '3', '--confirmation-runs-max', '3', '--output-path', dir], `${dir}/process.log`, 90000)
    const after = await readTrace(`${dir}/trace.jsonl`)
    await writeToml(`${dir}/measurement.toml`, { kind: 'shrink', ...run, before_actions: before?.actions, after_actions: after?.actions, retained_violation: !!after?.snapshot?.violations.length, status: after ? 'trace-produced' : 'incomplete-or-unsupported' })
    await rm(`${dir}/screenshots`, { recursive: true, force: true }); await rm(`${dir}/downloads`, { recursive: true, force: true })
    if (after) {
      for (let repeat = 1; repeat <= 3; repeat++) {
        const replayDir = `${dir}/replay-${repeat}`
        await mkdir(replayDir, { recursive: true })
        const replay = await runProcess([binary, 'browser', 'test', representative.url, representative.spec, '--headless', '--reproduce', dir, '--output-path', replayDir], `${replayDir}/process.log`)
        const trace = await readTrace(`${replayDir}/trace.jsonl`)
        await writeToml(`${replayDir}/measurement.toml`, { kind: 'shrink-replay', ...replay, reproduced: !!trace?.snapshot?.violations.length, actions: trace?.actions })
        await rm(`${replayDir}/screenshots`, { recursive: true, force: true }); await rm(`${replayDir}/downloads`, { recursive: true, force: true })
      }
    }
  }
  await copyFile('bun.lock', `${root}/bun.lock`)
  console.log(`Evidence: ${root}`)
} finally { server.kill('SIGTERM'); await server.exited }
