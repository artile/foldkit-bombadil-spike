import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

const value = (input: unknown): string => {
  if (input === undefined || input === null) return '"not_recorded"'
  if (typeof input === 'string' || typeof input === 'boolean' || typeof input === 'number') return JSON.stringify(input)
  if (Array.isArray(input)) return `[${input.map(value).join(', ')}]`
  if (typeof input === 'object') return `{ ${Object.entries(input).filter(([, item]) => item !== undefined).map(([key, item]) => `${JSON.stringify(key)} = ${value(item)}`).join(', ')} }`
  throw new Error(`Cannot encode TOML: ${typeof input}`)
}
export const writeToml = async (path: string, input: Record<string, unknown>) => {
  await mkdir(dirname(path), { recursive: true })
  await Bun.write(path, Object.entries(input).filter(([, item]) => item !== undefined).map(([key, item]) => `${key} = ${value(item)}\n`).join(''))
  // Fail at the producer if its output isn't TOML.
  Bun.TOML.parse(await Bun.file(path).text())
}
