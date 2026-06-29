import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { AgentEventStore } from '../src/lib/agentEvents/agentEventStore'

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')
const resultDir = join(repoRoot, '.shell-deck', 'probe-results', '006-online', stamp)
mkdirSync(resultDir, { recursive: true })

const dataRoot = join(resultDir, 'data-root')
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
codexArgs.push('-')

const startedAt = new Date().toISOString()
const childEnv: NodeJS.ProcessEnv = {
  ...process.env,
  SHELL_DECK_CONFIG_ID: 'local',
  SHELL_DECK_TERMINAL_ID: 'term_online_probe',
  SHELL_DECK_LAUNCH_ID: `launch_online_${Date.now()}`,
  SHELL_DECK_HOOK_DIR: resultDir,
  SHELL_DECK_DATA_ROOT: dataRoot,
}
delete childEnv.SHELL_DECK_INGEST_URL
delete childEnv.SHELL_DECK_INGEST_TOKEN

const result = spawnSync('just', codexArgs, {
  cwd: repoRoot,
  env: childEnv,
  encoding: 'utf8',
  timeout: Number(process.env.SHELL_DECK_ONLINE_TIMEOUT_MS ?? 180000),
  input: prompt,
})

const store = new AgentEventStore(dataRoot)
let imported = 0
try {
  imported = store.importSpool('local')
} catch {}
const events = store.list('local')
const latestPath = join(resultDir, 'latest.json')
const latest = existsSync(latestPath) ? JSON.parse(readFileSync(latestPath, 'utf8')) as Record<string, unknown> : null
const lastMessage = existsSync(lastMessagePath) ? readFileSync(lastMessagePath, 'utf8') : ''
const hasSessionStart = events.some((event) => event.eventKind === 'agent.session_started' && event.terminalId === 'term_online_probe' && typeof event.agentSessionId === 'string')
const hasStop = events.some((event) => event.eventKind === 'agent.output' && event.terminalId === 'term_online_probe' && typeof event.agentSessionId === 'string' && typeof event.capturedText === 'string' && event.adapterMetadata.codexSessionId === event.agentSessionId)
const hasLatest = latest?.eventKind === 'agent.output' || latest?.eventKind === 'agent.session_started'
const passed = result.status === 0 && imported > 0 && hasSessionStart && hasStop && hasLatest && lastMessage.length > 0

const summary = {
  probe: '20260627A.006-online',
  startedAt,
  finishedAt: new Date().toISOString(),
  command: ['just', ...codexArgs],
  status: passed ? 'passed' : 'failed',
  exitCode: result.status,
  signal: result.signal,
  checks: {
    codexExitedZero: result.status === 0,
    importedSpoolEvents: imported,
    hasSessionStart,
    hasStop,
    hasLatest,
    hasLastMessage: lastMessage.length > 0,
  },
  artifacts: {
    resultDir,
    dataRoot,
    latestPath,
    lastMessagePath,
  },
  stdout: result.stdout?.slice(-4000) ?? '',
  stderr: result.stderr?.slice(-4000) ?? '',
  events,
}

writeFileSync(join(resultDir, 'result.json'), `${JSON.stringify(summary, null, 2)}\n`)
console.log(JSON.stringify(summary, null, 2))
process.exit(passed ? 0 : 1)
