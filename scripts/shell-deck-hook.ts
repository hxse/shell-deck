import type { AgentEventInput } from '../src/lib/agentEvents/agentEventTypes'
import { codexHookErrorEvent, normalizeCodexHookPayload } from '../src/lib/agentEvents/codexHookAdapter'

const env = requiredContext()
const stdin = await Bun.stdin.text()
let event: AgentEventInput
try {
  event = normalizeCodexHookPayload(JSON.parse(stdin || '{}') as Record<string, unknown>, env)
} catch (error) {
  event = codexHookErrorEvent(env, error instanceof Error ? error.message : String(error))
}

try {
  const response = await fetch(requiredEnv('SHELL_DECK_INGEST_URL'), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-shell-deck-ingest-token': requiredEnv('SHELL_DECK_INGEST_TOKEN'),
    },
    body: JSON.stringify(event),
  })
  if (!response.ok) console.error('shell_deck_agent_event_ingest_failed:' + response.status)
} catch {
  console.error('shell_deck_agent_event_ingest_failed')
}

process.stdout.write(JSON.stringify({ continue: true }) + '\n')

function requiredContext() {
  return {
    roomGeneration: requiredEnv('SHELL_DECK_ROOM_GENERATION'),
    terminalId: requiredEnv('SHELL_DECK_TERMINAL_ID'),
    launchId: requiredEnv('SHELL_DECK_LAUNCH_ID'),
  }
}

function requiredEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error('shell_deck_room_context_required')
  return value
}
