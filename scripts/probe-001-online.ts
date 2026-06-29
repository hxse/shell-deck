import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')
const resultDir = join(repoRoot, '.shell-deck', 'probe-results', '001-online', stamp)
mkdirSync(resultDir, { recursive: true })

const lastMessagePath = join(resultDir, 'last-message.md')
const prompt = process.env.SHELL_DECK_ONLINE_PROMPT ?? 'Reply exactly with: shell-deck-online-probe. Do not run shell commands.'
const model = process.env.SHELL_DECK_CODEX_MODEL
const codexArgs = [
  '-f',
  join(repoRoot, 'justfile'),
  '--',
  'codex',
  'exec',
  '--skip-git-repo-check',
  '--ignore-rules',
  '--sandbox',
  'read-only',
  '--output-last-message',
  lastMessagePath,
]
if (model && model.length > 0) {
  codexArgs.push('--model', model)
}
codexArgs.push("-")

const startedAt = new Date().toISOString()
const result = spawnSync('just', codexArgs, {
  cwd: repoRoot,
  env: {
    ...process.env,
    SHELL_DECK_CONFIG_ID: 'local',
    SHELL_DECK_TERMINAL_ID: 'term_online_probe',
    SHELL_DECK_LAUNCH_ID: `launch_online_${Date.now()}`,
    SHELL_DECK_HOOK_DIR: resultDir,
  },
  encoding: 'utf8',
  timeout: Number(process.env.SHELL_DECK_ONLINE_TIMEOUT_MS ?? 180000),
  input: prompt,
})

const eventsPath = join(resultDir, 'events.jsonl')
const events = existsSync(eventsPath)
  ? readFileSync(eventsPath, 'utf8').trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>)
  : []
const lastMessage = existsSync(lastMessagePath) ? readFileSync(lastMessagePath, 'utf8') : ''
const hasSessionStart = events.some((event) => event.eventKind === 'agent.session_started' && event.terminalId === 'term_online_probe' && typeof event.agentSessionId === 'string')
const hasStop = events.some((event) => event.eventKind === 'agent.output' && event.terminalId === 'term_online_probe' && typeof event.agentSessionId === 'string' && typeof event.capturedText === 'string')
const passed = result.status === 0 && hasSessionStart && hasStop && lastMessage.length > 0

const summary = {
  probe: '20260627A.001-online',
  startedAt,
  finishedAt: new Date().toISOString(),
  command: ['just', ...codexArgs],
  status: passed ? 'passed' : 'failed',
  exitCode: result.status,
  signal: result.signal,
  checks: {
    codexExitedZero: result.status === 0,
    hasSessionStart,
    hasStop,
    hasLastMessage: lastMessage.length > 0,
  },
  artifacts: {
    resultDir,
    eventsPath,
    lastMessagePath,
  },
  stdout: result.stdout?.slice(-4000) ?? '',
  stderr: result.stderr?.slice(-4000) ?? '',
  events,
}

writeFileSync(join(resultDir, 'result.json'), `${JSON.stringify(summary, null, 2)}\n`)
console.log(JSON.stringify(summary, null, 2))
process.exit(passed ? 0 : 1)
