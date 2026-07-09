import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RunEventStore } from '../../src/lib/runLog/runEventStore'

test('store appends events with per-run monotonic sequence and rebuilds derived state', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-004-store-'))
  try {
    const store = new RunEventStore(root)
    const created = await store.createRun('local', { templateId: 'tmpl_demo' })
    await Promise.all([
      store.appendEvent('local', created.runId, { kind: 'step_started', stepId: 'send_review', summary: 'start send', data: {} }),
      store.appendEvent('local', created.runId, { kind: 'step_completed', stepId: 'send_review', summary: 'finish send', data: {} }),
      store.appendEvent('local', created.runId, { kind: 'run_paused', summary: 'pause', data: { reason: 'waiting' } }),
    ])

    const snapshot = store.snapshot('local', created.runId)
    expect(snapshot.replay.events.map((event) => event.eventSeq)).toEqual([1, 2, 3, 4])
    expect(snapshot.derivedState.status).toBe('paused')
    expect(snapshot.derivedState.pauseReason).toBe('waiting')
    expect(snapshot.derivedState.stepStatus.send_review).toBe('completed')
    expect(snapshot.nodeLogs.map((node) => node.nodeId)).toContain('send_review')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('store rejects duplicate generated eventId append and preserves log prefix', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-004-dup-append-'))
  try {
    const store = new RunEventStore(root, { eventIdFactory: () => 'evt_duplicate' })
    const created = await store.createRun('local')
    await expect(store.appendEvent('local', created.runId, { kind: 'run_paused', summary: 'pause', data: {} })).rejects.toThrow('duplicate_event_id')
    expect(store.snapshot('local', created.runId).replay.events).toHaveLength(1)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('store rejects appending event refs for missing artifacts', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-004-missing-ref-'))
  try {
    const store = new RunEventStore(root)
    const created = await store.createRun('local')
    await expect(store.appendEvent('local', created.runId, {
      kind: 'terminal_text_sent',
      stepId: 'send_review',
      summary: 'bad ref',
      data: { artifactRef: 'artifacts/missing.txt' },
    })).rejects.toThrow('missing_artifact_ref')
    expect(store.snapshot('local', created.runId).replay.events).toHaveLength(1)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('store writes artifact before event and isolates configs', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-004-store-artifact-'))
  try {
    const store = new RunEventStore(root)
    const created = await store.createRun('local')
    const result = await store.writeArtifact('local', created.runId, 'send', 'review docs only', 'txt', 'send_review')
    const snapshot = store.snapshot('local', created.runId)
    expect(store.readArtifact('local', created.runId, result.artifact.artifactRef)).toBe('review docs only')
    expect(snapshot.derivedState.artifactRefs).toContain(result.artifact.artifactRef)
    expect(() => store.readArtifact('other_config', created.runId, result.artifact.artifactRef)).toThrow()
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
