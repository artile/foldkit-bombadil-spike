import { mkdir } from 'node:fs/promises'
await mkdir('dist', { recursive: true })
for (const test of [true, false]) {
  const result = await Bun.build({ entrypoints: ['src/host.ts'], outdir: `dist/${test ? 'test' : 'production'}`, target: 'browser', minify: false, sourcemap: 'external', define: { TEST_BRIDGE: String(test) } })
  if (!result.success) throw new AggregateError(result.logs)
}
const production = await Bun.file('dist/production/host.js').text()
const test = await Bun.file('dist/test/host.js').text()
if (production.includes('__foldkitTest') || production.includes('Test transport controls')) throw new Error('Test bridge leaked into production bundle')
if (!test.includes('__foldkitTest')) throw new Error('Test build is missing its bridge')
