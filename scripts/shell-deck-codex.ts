import { mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const codexBin = process.env.SHELL_DECK_CODEX_BIN ?? 'codex'
const configId = process.env.SHELL_DECK_CONFIG_ID ?? 'local'
const terminalId = process.env.SHELL_DECK_TERMINAL_ID ?? 'term_manual'
const launchId = process.env.SHELL_DECK_LAUNCH_ID ?? 'launch_' + Date.now()
const targetCwd = resolve(process.env.SHELL_DECK_TARGET_CWD ?? process.cwd())
const dataRoot = process.env.SHELL_DECK_DATA_ROOT ?? process.cwd()
const hookDir = process.env.SHELL_DECK_HOOK_DIR ?? join(dataRoot, '.shell-deck', 'configs', configId, 'agent-events', 'debug', launchId)
mkdirSync(hookDir, { recursive: true })

const hookScript = join(repoRoot, 'scripts', 'shell-deck-hook.ts')
const hookCommand = shellQuote(process.execPath) + ' ' + shellQuote(hookScript) + ' --out ' + shellQuote(hookDir)
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
  env: {
    ...process.env,
    SHELL_DECK_CONFIG_ID: configId,
    SHELL_DECK_TERMINAL_ID: terminalId,
    SHELL_DECK_LAUNCH_ID: launchId,
    SHELL_DECK_HOOK_DIR: hookDir,
    SHELL_DECK_DATA_ROOT: dataRoot,
    SHELL_DECK_TARGET_CWD: targetCwd,
    PWD: targetCwd,
  },
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
