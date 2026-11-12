import { mkdir, rm } from 'node:fs/promises'
import { arch, platform } from 'node:os'
import { resolve } from 'node:path'
import { writeToml } from './data'
import { readTrace } from './traces'

// Follow-up, declared before execution: rerun ALL fixed-trace comparisons at
// 30s, not just failed samples. The original 15s attempts stay in the evidence.
const root = process.argv[2] ?? 'measurements/2026-11-12-fixed30'
if (await Bun.file(`${root}/environment.toml`).exists()) throw new Error('Fresh output directory required')
const sourceCommit = Bun.spawnSync(['git', 'rev-parse', 'HEAD']).stdout.toString().trim()
const diff = Bun.spawnSync(['git', 'diff', '--exit-code', 'HEAD', '--', 'src', 'spec', 'package.json', 'bun.lock', 'scripts/fixed-benchmark.ts'])
if (diff.exitCode) throw new Error('Commit source changes before measuring')
await mkdir(root, { recursive: true })
await writeToml(`${root}/environment.toml`, { source_commit: sourceCommit, recorded_at: new Date().toISOString(), purpose: 'Predeclared 30s follow-up: all 10 fixed browser runs; original 15s runs retained', budget_seconds: 30, repeats: 5, width: 1024, height: 768, fixture_source_commit: '175ec469a122863b96e07c845ba44a062c6e6cdc' })
const binary = resolve(process.env.BOMBADIL ?? `node_modules/@antithesishq/bombadil/binaries/bombadil-${platform()}-${arch()}`)
const server = Bun.spawn([process.execPath, 'scripts/server.ts'], { stdout: 'ignore', stderr: 'inherit' })
try {
  await new Promise(resolve => setTimeout(resolve, 500))
  if (server.exitCode !== null) throw new Error('Server exited')
  for (let repeat = 1; repeat <= 5; repeat++) for (const engine of repeat % 2 ? ['dom', 'direct'] : ['direct', 'dom']) {
    const dir = `${root}/fixed-${engine}-${repeat}`
    await mkdir(dir, { recursive: true })
    const command = ['browser', 'test', 'http://127.0.0.1:4173/?mutant=clean', `spec/trace-${engine}.ts`, '--headless', '--time-limit', '30s', '--exit-on-violation', '--output-path', dir]
    const start = performance.now(), startedAt = Date.now()
    const process = Bun.spawn([binary, ...command], { stdout: Bun.file(`${dir}/process.log`), stderr: Bun.file(`${dir}/process.log`) })
    const timer = setTimeout(() => process.kill('SIGTERM'), 60000)
    const exit = await process.exited
    clearTimeout(timer)
    const elapsed = performance.now() - start
    const trace = await readTrace(`${dir}/trace.jsonl`)
    const snapshot = trace?.snapshot
    await writeToml(`${dir}/measurement.toml`, {
      kind: 'fixed-trace', engine, repeat, command, budget_seconds: 30, exit, elapsed_ms: elapsed,
      status: snapshot?.semanticActions === 60 && snapshot.violations.length === 0 ? 'completed' : 'incomplete',
      semantic_actions: snapshot?.semanticActions, actions: trace?.actions, states: trace?.states,
      useful_ms: trace?.useful_ms, startup_to_first_snapshot_ms: trace ? trace.first_timestamp_ms - startedAt : undefined,
      ...snapshot,
    })
    await rm(`${dir}/screenshots`, { force: true, recursive: true }); await rm(`${dir}/downloads`, { force: true, recursive: true })
    console.log(`${engine}-${repeat}: ${snapshot?.semanticActions}/60, ${elapsed.toFixed(0)}ms wall`)
  }
} finally { server.kill('SIGTERM'); await server.exited }
