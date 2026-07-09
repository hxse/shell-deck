import { expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { ArtifactStore } from '../../src/lib/runLog/artifactStore'
import { buildRunNodeLogs } from '../../src/lib/runLog/runNodeLog'
import { RunEventReplay } from '../../src/lib/runLog/runEventReplay'
import { RunStoragePaths } from '../../src/lib/runLog/runStoragePaths'
import type { RunEvent, RunEventKind } from '../../src/lib/runLog/runEventTypes'

test('replay detects eventSeq gaps and keeps parsed prefix', () => {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-004-gap-'))
  try {
    writeEvents(root, 'local', 'run_gap', [event('run_gap', 1, 'evt_gap_1', 'run_started'), event('run_gap', 3, 'evt_gap_3', 'run_paused')])
    const replay = new RunEventReplay(root).replay('local', 'run_gap')
    expect(replay.ok).toBe(false)
    expect(replay.error?.kind).toBe('event_seq_gap')
    expect(replay.events.map((item) => item.eventSeq)).toEqual([1])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('replay detects duplicate eventId', () => {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-004-dup-'))
  try {
    writeEvents(root, 'local', 'run_dup', [event('run_dup', 1, 'evt_dup', 'run_started'), event('run_dup', 2, 'evt_dup', 'run_paused')])
    const replay = new RunEventReplay(root).replay('local', 'run_dup')
    expect(replay.ok).toBe(false)
    expect(replay.error?.kind).toBe('duplicate_event_id')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('replay detects invalid JSON and trailing half line', () => {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-004-corrupt-'))
  try {
    const paths = new RunStoragePaths(root)
    const invalidPath = paths.eventsPath('local', 'run_invalid')
    mkdirSync(dirname(invalidPath), { recursive: true })
    writeFileSync(invalidPath, JSON.stringify(event('run_invalid', 1, 'evt_valid', 'run_started')) + '\n{bad}\n')
    const invalid = new RunEventReplay(root).replay('local', 'run_invalid')
    expect(invalid.ok).toBe(false)
    expect(invalid.error?.kind).toBe('invalid_json')
    expect(invalid.events).toHaveLength(1)

    const halfPath = paths.eventsPath('local', 'run_half')
    mkdirSync(dirname(halfPath), { recursive: true })
    writeFileSync(halfPath, JSON.stringify(event('run_half', 1, 'evt_valid', 'run_started')) + '\n' + JSON.stringify(event('run_half', 2, 'evt_half', 'run_paused')))
    const half = new RunEventReplay(root).replay('local', 'run_half')
    expect(half.ok).toBe(false)
    expect(half.error?.kind).toBe('trailing_half_line')
    expect(half.events).toHaveLength(1)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('replay reports missing artifact refs as recoverable error', () => {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-004-missing-artifact-'))
  try {
    writeEvents(root, 'local', 'run_missing_artifact', [
      event('run_missing_artifact', 1, 'evt_start', 'run_started'),
      event('run_missing_artifact', 2, 'evt_artifact', 'terminal_text_sent', { terminalId: 'term_worker', enter: false, enterSequence: 'none', content: { artifactRef: 'artifacts/missing.txt', chars: 5 }, write: { artifactRef: 'artifacts/missing.txt', chars: 5 } }, 'send_review'),
    ])
    const replay = new RunEventReplay(root, new ArtifactStore(root)).replay('local', 'run_missing_artifact')
    expect(replay.ok).toBe(false)
    expect(replay.error?.kind).toBe('missing_artifact')
    expect(replay.error?.failedEvent?.stepId).toBe('send_review')
    expect(replay.events).toHaveLength(1)
    const node = buildRunNodeLogs(replay.events, replay.error).find((item) => item.nodeId === 'send_review')
    expect(node?.missingArtifactRefs).toEqual(['artifacts/missing.txt'])
    expect(node?.failedEvent?.kind).toBe('terminal_text_sent')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

function writeEvents(root: string, configId: string, runId: string, events: RunEvent[]) {
  const paths = new RunStoragePaths(root)
  const path = paths.eventsPath(configId, runId)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, events.map((item) => JSON.stringify(item)).join('\n') + '\n')
}

function event(runId: string, eventSeq: number, eventId: string, kind: RunEventKind, data: Record<string, unknown> = {}, stepId?: string): RunEvent {
  return {
    schemaVersion: 1,
    eventId,
    eventSeq,
    runId,
    configId: 'local',
    kind,
    createdAt: '2026-06-30T00:00:00.000Z',
    summary: kind,
    data,
    ...(stepId ? { stepId } : {}),
  }
}
