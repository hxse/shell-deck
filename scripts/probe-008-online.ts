import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MacroRunnerService } from '../server/macroRunnerService'
import { TerminalDeckManager } from '../server/terminalDeckManager'
import { AgentEventStore } from '../src/lib/agentEvents/agentEventStore'
import type { AgentEvent } from '../src/lib/agentEvents/agentEventTypes'
import { MacroTemplateStore } from '../src/lib/macro/templateStore'
import type { MacroTemplate, ParallelLane } from '../src/lib/macro/templateTypes'
import { ParserRuntime } from '../src/lib/parser/parserRuntime'
import { RunEventStore } from '../src/lib/runLog/runEventStore'

if (!process.argv.includes('--run-online')) {
  console.log('missing --run-online; skipping .008 online parallel_all probe')
  process.exit(0)
}

const root = mkdtempSync(join(tmpdir(), 'shell-deck-008-online-'))
try {
  const manager = new TerminalDeckManager()
  manager.ensureConfig('local')
  manager.createTerminal('local', { backend: 'fake', terminalId: 'term_online_main', terminalAlias: 'online_main' })
  manager.createTerminal('local', { backend: 'fake', terminalId: 'term_online_review', terminalAlias: 'online_review' })

  const templateStore = new MacroTemplateStore(root)
  const runStore = new RunEventStore(root)
  const agentStore = new AgentEventStore(root)
  const parserRuntime = new ParserRuntime(runStore, { aiJsonMode: 'codex-exec' })
  const service = new MacroRunnerService(manager, templateStore, runStore, agentStore, parserRuntime)

  templateStore.save('local', onlineTemplate(), manager.indexMap('local'))
  await service.start('local', { templateId: 'probe-008-online' })
  await waitFor(() => (service.snapshot('local').run?.replay.events.filter((event) => event.kind === 'parallel_lane_waiting').length ?? 0) === 2, 5000)

  agentStore.append(agentOutput('term_online_main', 'AI can directly fix no blocking issues. Only P3 or clean.', 'turn-main'))
  agentStore.append(agentOutput('term_online_review', 'No user decision is required. Only P3 or clean.', 'turn-review'))

  await waitFor(() => {
    const status = service.snapshot('local').status
    return status === 'completed' || status === 'paused' || status === 'failed'
  }, 120000)

  const snapshot = service.snapshot('local')
  const parserEvents = snapshot.run?.replay.events.filter((event) => event.kind === 'parallel_lane_parser_normalized') ?? []
  console.log(JSON.stringify({ ok: snapshot.status === 'completed', status: snapshot.status, pauseReason: snapshot.pauseReason, parserEventCount: parserEvents.length, runId: snapshot.run?.runId }, null, 2))
  if (snapshot.status !== 'completed') process.exit(1)
} finally {
  rmSync(root, { recursive: true, force: true })
}

function onlineTemplate(): MacroTemplate {
  const now = new Date('2026-07-01T00:00:00.000Z').toISOString()
  return {
    schemaVersion: 1,
    id: 'probe-008-online',
    name: 'probe-008-online',
    description: 'Online parallel_all smoke with two AgentEvent lanes and real codex-exec parser',
    configId: 'local',
    createdAt: now,
    updatedAt: now,
    steps: [
      {
        id: 'parallel_online_review',
        type: 'parallel_all',
        lanes: [agentLane('main_lane', 'online_main', 'main'), agentLane('review_lane', 'online_review', 'review')],
        join: { mode: 'all_success', onLaneFail: 'pause', onTimeout: 'pause' },
        next: 'done',
      },
      { id: 'done', type: 'complete', reason: 'online parallel_all smoke completed' },
    ],
  }
}

function agentLane(id: string, terminalAlias: string, prefix: string): ParallelLane {
  const terminal = { kind: 'alias' as const, value: terminalAlias }
  const captureStep = 'capture_' + prefix
  const parseStep = 'parse_' + prefix
  return {
    id,
    terminal,
    steps: [
      { id: 'send_' + prefix, type: 'send_line', text: 'online parallel_all smoke ' + prefix },
      { id: 'wait_' + prefix, type: 'wait', mode: 'capture-ready-or-user', captureStep, timeoutMs: 60000, onTimeout: 'pause' },
      { id: captureStep, type: 'capture-source', capture: { kind: 'agent-event', agentKind: 'codex', eventKind: 'agent.output', adapter: 'codex-stop-hook', terminal } },
      { id: parseStep, type: 'parse', captureStep, parser: { kind: 'ai-json', profileId: 'review-routing-v1' } },
    ],
    success: { fromParseStep: parseStep, mode: 'all', conditions: [{ signal: 'onlyP3OrClean', op: '==', value: true }] },
  }
}

function agentOutput(terminalId: string, text: string, turnId: string): AgentEvent {
  const codexSessionId = 'codex-session-' + terminalId
  return {
    protocolVersion: 1,
    agentKind: 'codex',
    eventKind: 'agent.output',
    configId: 'local',
    terminalId,
    launchId: 'launch_008_online',
    agentSessionId: codexSessionId,
    agentTurnId: turnId,
    adapterMetadata: { adapter: 'codex-stop-hook', codexSessionId },
    capturedText: text,
    raw: { source: 'codex.Stop', payload: { hook_event_name: 'Stop' } },
    receivedAt: new Date().toISOString(),
  }
}

async function waitFor(predicate: () => boolean, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('timeout waiting for .008 online probe')
}
