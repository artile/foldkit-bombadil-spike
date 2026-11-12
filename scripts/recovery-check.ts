import assert from 'node:assert/strict'
import { closeSync, openSync } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import { arch, platform } from 'node:os'
import { resolve } from 'node:path'
import { writeToml } from './data'
import { readTrace } from './traces'
const root = process.argv[2] ?? 'measurements/2026-11-12-final-recovery'
const sourceCommit = Bun.spawnSync(['git', 'rev-parse', 'HEAD']).stdout.toString().trim()
if (await Bun.file(`${root}/environment.toml`).exists()) throw new Error('Fresh output directory required')
await writeToml(`${root}/environment.toml`, { source_commit: sourceCommit, purpose: 'Post-measurement Dialog panel CSS repair: deterministic clean and recovery-mutant regression checks; not throughput samples', trace: ['refresh', 'delay', 'fail-newest', 'dismiss'], limit_seconds: 15 })
const binary = resolve(`node_modules/@antithesishq/bombadil/binaries/bombadil-${platform()}-${arch()}`)
const server = Bun.spawn([process.execPath, 'scripts/server.ts'], { stdout: 'ignore', stderr: 'inherit' })
try {
  await new Promise(resolve => setTimeout(resolve, 500))
  if (server.exitCode !== null) throw new Error('Server exited')
  for (const engine of ['dom', 'direct']) for (const mutant of ['clean', 'recovery']) {
    const dir = `${root}/${engine}-${mutant}`
    await mkdir(dir, { recursive: true })
    const fd = openSync(`${dir}/process.log`, 'w')
    const args = ['browser', 'test', `http://127.0.0.1:4173/?mutant=${mutant}`, `spec/recovery-${engine}.ts`, '--headless', '--time-limit', '15s', '--exit-on-violation', '--output-path', dir]
    const process = Bun.spawn([binary, ...args], { stdout: fd, stderr: fd })
    const timer = setTimeout(() => process.kill('SIGTERM'), 45000)
    const exit = await process.exited
    clearTimeout(timer); closeSync(fd)
    const trace = await readTrace(`${dir}/trace.jsonl`)
    const snapshot = trace?.snapshot
    const passed = snapshot?.semanticActions === 4 && (mutant === 'clean' ? snapshot.violations.length === 0 : snapshot.violations.includes('dialog_recovers'))
    await writeToml(`${dir}/measurement.toml`, { kind: 'final-regression', source_commit: sourceCommit, engine, mutant, passed, exit, command: args, ...snapshot })
    await rm(`${dir}/screenshots`, { recursive: true, force: true }); await rm(`${dir}/downloads`, { recursive: true, force: true })
    assert(passed, `${engine}/${mutant} regression check failed`)
    console.log(`${engine}/${mutant}: expected outcome, 4 semantic actions`)
  }
} finally { server.kill('SIGTERM'); await server.exited }
