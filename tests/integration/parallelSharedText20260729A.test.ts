import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startShellDeckServer } from '../../server/httpServer'
import type {
  MacroDefinitionV6,
  MacroRecord,
  ParallelLaneActionNode,
} from '../../src/lib/macro/macroDefinitionTypes'
import { setTextTerminalContent } from '../helpers/textTerminal'
import {
  replay,
  request,
  roomGrant,
  waitFor,
} from './macroRuntime034.helpers'

test('Parallel appends shared Text in pane order before outside Capture consumes it', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-parallel-text-20260729a-'))
  const server = startShellDeckServer({
    accessMode: 'guest',
    listenMode: 'local',
    port: 0,
    dataRoot: root,
  })
  try {
    const room = server.manager.createRoom()
    const sharedText = server.manager.createTerminal(room.roomId, { backend: 'text' })
    const forwardedText = server.manager.createTerminal(room.roomId, { backend: 'text' })
    setTextTerminalContent(server.manager, room.roomId, sharedText.terminalId, 'seed:')
    const grant = roomGrant(server.manager, room.roomId)
    const created = await request(server.url, '/api/templates', grant, {
      definition: definition(),
    })
    expect(created.status).toBe(201)
    const record = (created.body as { template: MacroRecord }).template

    const started = await request(
      server.url,
      `/api/rooms/${room.roomId}/runner/start`,
      grant,
      {
        templateId: record.id,
        expectedMacroRevision: record.revision,
        expectedTerminalStructureRevision: server.manager.terminalStructureRevision(room.roomId),
      },
    )
    expect(started.status).toBe(201)
    await waitFor(() => server.macroRunner.snapshot(room.roomId).status === 'completed')

    expect(replay(server, room.roomId, sharedText.terminalId)).toBe('seed:AB')
    expect(replay(server, room.roomId, forwardedText.terminalId)).toBe('seed:AB')
  } finally {
    await server.stop()
    rmSync(root, { recursive: true, force: true })
  }
})

for (const outcome of ['fail', 'finish'] as const) {
  test(`Parallel ${outcome} cancels an unbounded AgentEvent sibling`, async () => {
    const root = mkdtempSync(join(tmpdir(), `shell-deck-parallel-cancel-${outcome}-`))
    const server = startShellDeckServer({
      accessMode: 'guest',
      listenMode: 'local',
      port: 0,
      dataRoot: root,
    })
    try {
      const room = server.manager.createRoom()
      server.manager.createTerminal(room.roomId, { backend: 'text' })
      server.manager.createTerminal(room.roomId, { backend: 'fake' })
      const grant = roomGrant(server.manager, room.roomId)
      const created = await request(server.url, '/api/templates', grant, {
        definition: cancellationDefinition(outcome),
      })
      expect(created.status).toBe(201)
      const record = (created.body as { template: MacroRecord }).template
      const started = await request(
        server.url,
        `/api/rooms/${room.roomId}/runner/start`,
        grant,
        {
          templateId: record.id,
          expectedMacroRevision: record.revision,
          expectedTerminalStructureRevision: server.manager.terminalStructureRevision(room.roomId),
        },
      )
      expect(started.status).toBe(201)
      await waitFor(() => ['completed', 'failed'].includes(
        server.macroRunner.snapshot(room.roomId).status,
      ))
      const snapshot = server.macroRunner.snapshot(room.roomId)
      expect(snapshot.status).toBe(outcome === 'finish' ? 'completed' : 'failed')
      if (outcome === 'fail') {
        expect(snapshot.error).toContain('parallel_lane_failed:lane_a:extract_text_empty')
      }
    } finally {
      await server.stop()
      rmSync(root, { recursive: true, force: true })
    }
  })
}

function definition(): MacroDefinitionV6 {
  return {
    schemaVersion: 6,
    name: 'Parallel shared Text',
    description: '',
    terminalLayout: [
      { index: 1, type: 'text' },
      { index: 2, type: 'text' },
    ],
    body: [
      {
        id: 'parallel',
        type: 'parallel',
        sharedTextOrder: 'pane_order',
        onLaneFail: 'fail',
        lanes: [
          {
            id: 'lane_a',
            label: 'A',
            body: [
              { id: 'delay_a', type: 'wait', mode: 'duration', durationMs: 40 },
              send('send_a', 1, 'A'),
            ],
          },
          {
            id: 'lane_b',
            label: 'B',
            body: [send('send_b', 1, 'B')],
          },
        ],
      },
      {
        id: 'capture_shared',
        type: 'capture-source',
        capture: {
          kind: 'text-box',
          terminal: { kind: 'terminal_index', index: 1 },
        },
      },
      {
        ...send('forward_shared', 2, ''),
        message: {
          parts: [{
            kind: 'artifact',
            source: {
              kind: 'step_artifact',
              stepId: 'capture_shared',
              artifact: 'captured_text',
            },
          }],
        },
      },
    ],
  }
}

function cancellationDefinition(outcome: 'fail' | 'finish'): MacroDefinitionV6 {
  return {
    schemaVersion: 6,
    name: `Parallel ${outcome} cancellation`,
    description: '',
    terminalLayout: [
      { index: 1, type: 'text' },
      { index: 2, type: 'shell' },
    ],
    body: [{
      id: 'parallel',
      type: 'parallel',
      sharedTextOrder: 'pane_order',
      onLaneFail: 'fail',
      lanes: [
        {
          id: 'lane_a',
          label: 'A',
          body: [
            {
              id: 'capture_empty',
              type: 'capture-source',
              capture: {
                kind: 'text-box',
                terminal: { kind: 'terminal_index', index: 1 },
              },
            },
            {
              id: 'empty_outcome',
              type: 'extract_text',
              source: {
                kind: 'step_artifact',
                stepId: 'capture_empty',
                artifact: 'captured_text',
              },
              split: { kind: 'lines', keepEmpty: false },
              filters: [],
              select: { mode: 'all' },
              extract: { kind: 'none' },
              trim: 'none',
              onEmpty: outcome,
            },
          ],
        },
        {
          id: 'lane_b',
          label: 'B',
          body: [{
            id: 'capture_unbounded',
            type: 'capture-source',
            capture: {
              kind: 'agent-event',
              terminal: { kind: 'terminal_index', index: 2 },
              agent: { kind: 'codex' },
              captureMode: 'result_only',
              waitLimit: { kind: 'unbounded' },
            },
          }],
        },
      ],
    }],
  }
}

function send(
  id: string,
  terminalIndex: number,
  text: string,
): Extract<ParallelLaneActionNode, { type: 'send' }> {
  return {
    id,
    type: 'send',
    terminal: { kind: 'terminal_index', index: terminalIndex },
    message: { parts: [{ kind: 'text', text }] },
    delivery: 'direct',
    ending: 'none',
  }
}
