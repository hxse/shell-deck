import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { AgentEventStore } from '../src/lib/agentEvents/agentEventStore'
import type { AgentEvent } from '../src/lib/agentEvents/agentEventTypes'
import { codexHookErrorEvent, normalizeCodexHookPayload } from '../src/lib/agentEvents/codexHookAdapter'

const env = {
  configId: process.env.SHELL_DECK_CONFIG_ID ?? 'local',
  terminalId: process.env.SHELL_DECK_TERMINAL_ID ?? 'term_manual',
  launchId: process.env.SHELL_DECK_LAUNCH_ID ?? 'launch_manual',
}
const outDir = argValue('--out') ?? process.env.SHELL_DECK_HOOK_DIR ?? join(process.cwd(), '.shell-deck', 'configs', env.configId, 'agent-events', 'debug', env.launchId)
mkdirSync(outDir, { recursive: true })

const stdin = await Bun.stdin.text()
const receivedAt = new Date().toISOString()
const rawPath = join(outDir, 'raw-' + Date.now() + '.json')
writeFileSync(rawPath, stdin.trim().length > 0 ? stdin : '{}')

let event: AgentEvent
try {
  const payload = JSON.parse(stdin || '{}') as Record<string, unknown>
  event = normalizeCodexHookPayload(payload, env, receivedAt)
} catch (error) {
  event = codexHookErrorEvent(env, receivedAt, error instanceof Error ? error.message : String(error))
}
event.raw.payloadRef = rawPath

try {
  const posted = await postToIngest(event)
  if (!posted) {
    const spoolPath = new AgentEventStore(process.env.SHELL_DECK_DATA_ROOT ?? process.cwd()).spool(event)
    writeFileSync(join(outDir, 'latest-spool-path.txt'), spoolPath + '\n')
  }
  writeFileSync(join(outDir, 'latest.json'), JSON.stringify(event, null, 2) + '\n')
} catch (error) {
  const failure = codexHookErrorEvent(env, new Date().toISOString(), error instanceof Error ? error.message : String(error), event.agentSessionId, event.raw.payload ?? {})
  failure.raw.payloadRef = rawPath
  try {
    new AgentEventStore(process.env.SHELL_DECK_DATA_ROOT ?? process.cwd()).spool(failure)
    writeFileSync(join(outDir, 'latest.json'), JSON.stringify(failure, null, 2) + '\n')
  } catch {
    writeFileSync(join(outDir, 'latest-error.txt'), (error instanceof Error ? error.message : String(error)) + '\n')
  }
}

process.stdout.write(JSON.stringify({ continue: true }) + '\n')

async function postToIngest(event: AgentEvent): Promise<boolean> {
  const url = process.env.SHELL_DECK_INGEST_URL
  const token = process.env.SHELL_DECK_INGEST_TOKEN
  if (!url || !token) return false
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-shell-deck-ingest-token': token,
      },
      body: JSON.stringify(event),
    })
    return response.ok
  } catch {
    return false
  }
}

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  if (index === -1) return undefined
  return process.argv[index + 1]
}
