import { createHash } from 'node:crypto'
import { writeToml } from './data'
const roots = process.argv.slice(2)
if (!roots.length) throw new Error('Pass one or more evidence directories')
for (const root of roots) {
  const paths = (await Array.fromAsync(new Bun.Glob('**/*').scan({ cwd: root, onlyFiles: true }))).filter(path => path !== 'sha256.toml').sort()
  const files = await Promise.all(paths.map(async path => {
    const bytes = new Uint8Array(await Bun.file(`${root}/${path}`).arrayBuffer())
    return { path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }
  }))
  await writeToml(`${root}/sha256.toml`, { algorithm: 'SHA-256', files })
  console.log(`${root}: ${files.length} files, ${files.reduce((sum, file) => sum + file.bytes, 0)} bytes`)
}
