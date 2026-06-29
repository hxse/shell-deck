import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { normalizeCodexHookPayload } from '../src/probe001/agentEvent'

const outDir = argValue('--out') ?? process.env.SHELL_DECK_HOOK_DIR ?? join(process.cwd(), '.shell-deck', 'agent-events', 'manual')
mkdirSync(outDir, { recursive: true })

const stdin = readFileSync(0, 'utf8')
const receivedAt = new Date().toISOString()
const rawPath = join(outDir, `raw-${Date.now()}.json`)
writeFileSync(rawPath, stdin.length > 0 ? stdin : '{}')

try {
  const payload = JSON.parse(stdin) as Record<string, unknown>
  const event = normalizeCodexHookPayload(payload, {
    configId: process.env.SHELL_DECK_CONFIG_ID ?? 'local',
    terminalId: process.env.SHELL_DECK_TERMINAL_ID ?? 'term_manual',
    launchId: process.env.SHELL_DECK_LAUNCH_ID ?? 'launch_manual',
  }, receivedAt)
  event.raw.payloadRef = rawPath
  writeFileSync(join(outDir, 'events.jsonl'), `${JSON.stringify(event)}\n`, { flag: 'a' })
  writeFileSync(join(outDir, 'latest.json'), `${JSON.stringify(event, null, 2)}\n`)
} catch (error) {
  const failure = {
    protocolVersion: 1,
    agentKind: 'codex',
    eventKind: 'agent.error',
    configId: process.env.SHELL_DECK_CONFIG_ID ?? 'local',
    terminalId: process.env.SHELL_DECK_TERMINAL_ID ?? 'term_manual',
    launchId: process.env.SHELL_DECK_LAUNCH_ID ?? 'launch_manual',
    agentSessionId: 'unknown',
    adapterMetadata: {
      adapter: 'codex-hook-error',
      codexSessionId: 'unknown',
    },
    raw: {
      source: 'codex.hook_receiver_failed',
      payloadRef: rawPath,
      payload: {},
    },
    receivedAt,
    error: error instanceof Error ? error.message : String(error),
  }
  writeFileSync(join(outDir, 'events.jsonl'), `${JSON.stringify(failure)}\n`, { flag: 'a' })
  writeFileSync(join(outDir, 'latest.json'), `${JSON.stringify(failure, null, 2)}\n`)
}

process.stdout.write(JSON.stringify({ continue: true }) + '\n')

function argValue(name: string) {
  const index = process.argv.indexOf(name)
  if (index === -1) {
    return undefined
  }
  return process.argv[index + 1]
}
