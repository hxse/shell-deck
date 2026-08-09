import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const requiredContext = [
  'SHELL_DECK_SERVER_INSTANCE_ID',
  'SHELL_DECK_ROOM_ID',
  'SHELL_DECK_ROOM_GENERATION',
  'SHELL_DECK_TERMINAL_ID',
  'SHELL_DECK_LAUNCH_ID',
  'SHELL_DECK_INGEST_URL',
  'SHELL_DECK_INGEST_TOKEN',
] as const

if (requiredContext.some((name) => !process.env[name])) {
  console.error('shell_deck_room_context_required')
  process.exit(1)
}

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const targetCwd = resolve(process.env.SHELL_DECK_TARGET_CWD ?? process.cwd())
const codexBin = process.env.SHELL_DECK_CODEX_BIN ?? 'codex'
const hookScript = join(repoRoot, 'scripts', 'shell-deck-hook.ts')
const hookCommand = shellQuote(process.execPath) + ' ' + shellQuote(hookScript)
const hookConfig = (name: string) => 'hooks.' + name + '=[{matcher="*", hooks=[{type="command", command=' + tomlString(hookCommand) + ', timeout=10}]}]'
const hookArgs = process.env.SHELL_DECK_DISABLE_HOOKS === '1'
  ? []
  : [
      '--dangerously-bypass-hook-trust',
      '-c',
      'features.hooks=true',
      '-c',
      hookConfig('SessionStart'),
      '-c',
      hookConfig('UserPromptSubmit'),
      '-c',
      hookConfig('Stop'),
    ]

const result = spawnSync(codexBin, [...hookArgs, ...process.argv.slice(2)], {
  cwd: targetCwd,
  env: { ...process.env, SHELL_DECK_TARGET_CWD: targetCwd, PWD: targetCwd },
  stdio: 'inherit',
})

if (result.error) {
  console.error(result.error.message)
  process.exit(1)
}
process.exit(result.status ?? 1)

function shellQuote(value: string): string {
  return "'" + value.replaceAll("'", "'\\''") + "'"
}

function tomlString(value: string): string {
  return JSON.stringify(value)
}
