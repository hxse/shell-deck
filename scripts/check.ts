import { spawnSync } from 'node:child_process'

const commands = [
  ['bun', ['x', 'tsc', '--noEmit']],
  ['bun', ['x', 'svelte-check', '--tsconfig', './tsconfig.json']],
] as const

for (const [command, args] of commands) {
  const result = spawnSync(command, args, { stdio: 'inherit' })
  if (result.error) {
    console.error(result.error.message)
    process.exit(1)
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}
