import { expect, test } from 'bun:test'
import { lstatSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { EvidenceStore } from '../../server/evidenceStore'
import { assertEvidenceEvent, assertEvidenceSummary } from '../../server/evidenceRecordValidation'
import { createGeneratedId } from '../../src/lib/generatedId'

test('Trace and artifacts live in the user-global evidence tree without resumable runtime state', () => {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-032-evidence-'))
  try {
    const store = new EvidenceStore(root)
    const provenance = {
      serverInstanceId: createGeneratedId('serverInstance'),
      roomId: createGeneratedId('room'),
      roomGeneration: createGeneratedId('roomGeneration'),
    }
    const runId = store.createRun(provenance, { template: 'opaque' })
    const appended = store.append(runId, 'step_completed', { stepId: 'send' })
    const retried = store.appendAtSequence(runId, 'step_completed', { stepId: 'send' }, provenance, 2)
    expect(retried.eventId).toBe(appended.eventId)
    expect(() => store.appendAtSequence(runId, 'step_completed', { stepId: 'other' }, provenance, 2))
      .toThrow('evidence_event_sequence_conflict')
    const artifactRef = store.writeArtifact(runId, 'captured', 'result')
    expect(store.read(runId).map((event) => event.kind)).toEqual(['run_started', 'step_completed', 'artifact_created'])
    expect(artifactRef).toMatch(/^artifacts\/captured-/)
    expect(lstatSync(join(root, 'runs', runId, 'summary.json')).mode & 0o777).toBe(0o600)
    expect(lstatSync(join(root, 'runs', runId, 'events', '000000000001.jsonl')).mode & 0o777).toBe(0o600)
    expect(lstatSync(join(root, 'runs', runId, artifactRef)).mode & 0o777).toBe(0o600)
    expect(store).not.toHaveProperty('resume')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('evidence event and summary codecs retain exact current-schema keys', () => {
  const runId = createGeneratedId('run')
  const provenance = {
    serverInstanceId: createGeneratedId('serverInstance'),
    roomId: createGeneratedId('room'),
    roomGeneration: createGeneratedId('roomGeneration'),
  }
  const event = {
    schemaVersion: 1 as const,
    eventId: createGeneratedId('runEvent'),
    eventSeq: 1,
    runId,
    kind: 'run_started',
    createdAt: '2026-07-23T00:00:00.000Z',
    ...provenance,
    data: {},
  }
  const summary = {
    schemaVersion: 1 as const,
    runId,
    ...provenance,
    startedAt: event.createdAt,
    updatedAt: event.createdAt,
    firstAvailableEventSeq: 1,
    lastEventSeq: 1,
    totalEventCount: 1,
    discardedEventCount: 0,
    lastEventKind: event.kind,
  }

  expect(assertEvidenceEvent(event)).toBe(event)
  expect(assertEvidenceSummary(summary, runId)).toBe(summary)
  expect(() => assertEvidenceEvent({ ...event, extra: true })).toThrow('invalid_evidence_event')
  expect(() => assertEvidenceSummary({ ...summary, extra: true }, runId)).toThrow('invalid_evidence_summary')
})

test('EvidenceStore remains the sole production facade for evidence storage modules', () => {
  const serverRoot = resolve(import.meta.dir, '../../server')
  const facadePath = resolve(serverRoot, 'evidenceStore.ts')
  const storagePath = resolve(serverRoot, 'evidenceSegmentStorage.ts')
  const validationPath = resolve(serverRoot, 'evidenceRecordValidation.ts')
  const facade = readFileSync(facadePath, 'utf8')
  const storage = readFileSync(storagePath, 'utf8')
  const validation = readFileSync(validationPath, 'utf8')
  const productionFiles = readdirSync(serverRoot).filter((file) => file.endsWith('.ts'))

  const storageConsumers = productionFiles
    .filter((file) => /from ['"]\.\/evidenceSegmentStorage['"]/.test(readFileSync(resolve(serverRoot, file), 'utf8')))
    .sort()
  const validationConsumers = productionFiles
    .filter((file) => /from ['"]\.\/evidenceRecordValidation['"]/.test(readFileSync(resolve(serverRoot, file), 'utf8')))
    .sort()

  expect(storageConsumers).toEqual(['evidenceStore.ts'])
  expect(validationConsumers).toEqual(['evidenceSegmentStorage.ts', 'evidenceStore.ts'])
  expect(storage).not.toMatch(/from ['"]\.\/evidenceStore['"]/)
  expect(validation).not.toMatch(/from ['"]\.\/evidenceStore['"]/)
  expect(facade).toContain('private readonly appendCursors')
  expect(facade).toContain('private readonly maintenanceDebt')
  expect(storage + validation).not.toContain('appendCursors')
  expect(storage + validation).not.toContain('maintenanceDebt')
  for (const source of [facade, storage, validation]) {
    expect(source.trimEnd().split('\n').length).toBeLessThanOrEqual(400)
  }
})
