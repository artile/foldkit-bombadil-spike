import { mkdir } from 'node:fs/promises'
await mkdir('dist', { recursive: true })
for (const test of [true, false]) {
  const result = await Bun.build({ entrypoints: ['src/host.ts'], outdir: `dist/${test ? 'test' : 'production'}`, target: 'browser', minify: false, sourcemap: 'external', define: { TEST_BRIDGE: String(test) } })
  if (!result.success) throw new AggregateError(result.logs)
}
