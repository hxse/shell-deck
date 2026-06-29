import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ArtifactStore } from '../../src/lib/runLog/artifactStore'
import { RunEventReplay } from '../../src/lib/runLog/runEventReplay'

test('artifact store writes, reads, lists and rejects path escape refs', () => {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-004-artifact-'))
  try {
    const store = new ArtifactStore(root)
    const artifact = store.writeText('local', 'run_artifact', 'send', 'review docs only', 'txt')
    expect(artifact.artifactRef).toStartWith('artifacts/send-')
    expect(store.readText('local', 'run_artifact', artifact.artifactRef)).toBe('review docs only')
    expect(store.listRefs('local', 'run_artifact')).toContain(artifact.artifactRef)
    expect(() => store.pathForRef('local', 'run_artifact', 'artifacts/../escape.txt')).toThrow('invalid_artifact_ref')
    expect(() => store.pathForRef('local', 'run_artifact', '/tmp/escape.txt')).toThrow('invalid_artifact_ref')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('orphan artifacts are diagnostics, not a second state truth', () => {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-004-orphan-'))
  try {
    const store = new ArtifactStore(root)
    const artifact = store.writeText('local', 'run_orphan', 'capture', 'raw output')
    const replay = new RunEventReplay(root, store).replay('local', 'run_orphan')
    expect(replay.ok).toBe(true)
    expect(replay.diagnostics).toEqual(['orphan_artifact:' + artifact.artifactRef])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
