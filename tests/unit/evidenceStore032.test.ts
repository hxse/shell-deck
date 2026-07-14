import { expect, test } from 'bun:test'
import { lstatSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EvidenceStore } from '../../server/evidenceStore'
import { createGeneratedId } from '../../src/lib/generatedId'

test('Trace and artifacts live in the user-global evidence tree without resumable runtime state', () => {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-032-evidence-'))
  try {
    const store = new EvidenceStore(root)
    const runId = store.createRun({
      serverInstanceId: createGeneratedId('serverInstance'),
      roomId: createGeneratedId('room'),
      roomGeneration: createGeneratedId('roomGeneration'),
    }, { template: 'opaque' })
    store.append(runId, 'step_completed', { stepId: 'send' })
    const artifactRef = store.writeArtifact(runId, 'captured', 'result')
    expect(store.read(runId).map((event) => event.kind)).toEqual(['run_started', 'step_completed', 'artifact_created'])
    expect(artifactRef).toMatch(/^artifacts\/captured-/)
    expect(lstatSync(join(root, 'runs', runId, 'summary.json')).mode & 0o777).toBe(0o600)
    expect(lstatSync(join(root, 'runs', runId, 'events', '000000000001.jsonl')).mode & 0o777).toBe(0o600)
    expect(lstatSync(join(root, 'runs', runId, artifactRef)).mode & 0o777).toBe(0o600)
    expect(store).not.toHaveProperty('resume')
  } finally { rmSync(root, { recursive: true, force: true }) }
})
