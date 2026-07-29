import { expect, test } from 'bun:test'
import { appendFileSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createGeneratedId } from '../../src/lib/generatedId'
import type { MacroDefinitionV6 } from '../../src/lib/macro/macroDefinitionTypes'
import type { RunManifestV1 } from '../../src/lib/macro/runnerTypes'
import { EvidenceStore, RUN_EVENT_RETENTION_LIMIT } from '../../server/evidenceStore'
import { canonicalJsonStringify, macroDefinitionHash, MacroRunStore } from '../../server/macroRunStore'
import { MacroRunTraceIndex } from '../../server/macroRunTraceIndex'
import { publishPrivateFileDelete, writePrivateFileAtomic } from '../../server/userDataRoot'
import { storeTracesForRoom } from '../helpers/macroTrace'

test('RunManifest uses canonical definition hash and private persistent artifact/Trace files', () => {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-run-store-034-'))
  try {
    const store = new MacroRunStore(root, () => '2026-07-15T00:00:00.000Z')
    const definition: MacroDefinitionV6 = { schemaVersion: 6, name: 'hash', description: '', terminalLayout: [], body: [] }
    const manifest = runManifest(store.reserveRunId(), definition)
    expect(macroDefinitionHash(definition)).toMatch(/^[0-9a-f]{64}$/)
    expect(canonicalJsonStringify({ z: 1, a: { y: 2, x: 3 } })).toBe('{"a":{"x":3,"y":2},"z":1}')
    const ref = store.publishManifest(manifest)
    const started = store.append(manifest.runId, 'run_started', { manifestRef: ref })
    expect(started).toMatchObject({
      serverInstanceId: manifest.runtime.serverInstanceId,
      roomId: manifest.runtime.roomId,
      roomGeneration: manifest.runtime.roomGeneration,
    })
    const artifactRef = store.writeArtifact(manifest.runId, 'capture', 'hello')
    store.append(manifest.runId, 'artifact_created', { artifactRef })
    store.append(manifest.runId, 'run_completed')

    const runDir = join(root, 'runs', manifest.runId)
    expect(lstatSync(join(runDir, 'manifest.json')).mode & 0o777).toBe(0o600)
    expect(lstatSync(join(runDir, 'summary.json')).mode & 0o777).toBe(0o600)
    expect(lstatSync(join(runDir, 'events', '000000000001.jsonl')).mode & 0o777).toBe(0o600)
    expect(lstatSync(join(runDir, artifactRef)).mode & 0o777).toBe(0o600)
    expect(readFileSync(join(runDir, artifactRef), 'utf8')).toBe('hello')
    expect(storeTracesForRoom(store, manifest.runtime.roomId)[0]).toMatchObject({ runId: manifest.runId, status: 'completed', macroRecord: manifest.macroRecord })
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('a durable run_started without a terminal event is derived as interrupted, never resumable state', () => {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-run-interrupted-034-'))
  try {
    const store = new MacroRunStore(root)
    const definition: MacroDefinitionV6 = { schemaVersion: 6, name: 'interrupted', description: '', terminalLayout: [], body: [] }
    const manifest = runManifest(store.reserveRunId(), definition)
    store.publishManifest(manifest)
    store.append(manifest.runId, 'run_started')
    expect(storeTracesForRoom(store, manifest.runtime.roomId)[0]?.status).toBe('interrupted')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('cold Trace repairs a stale valid summary once, then returns to zero-segment reads', () => {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-run-trace-summary-034-'))
  try {
    let failTerminalSummary = true
    const writerEvidence = new EvidenceStore(root, undefined, {
      writeSummary(path, bytes) {
        const summary = JSON.parse(bytes) as { lastEventKind: string }
        if (summary.lastEventKind === 'run_failed' && failTerminalSummary) {
          failTerminalSummary = false
          throw new Error('synthetic_terminal_summary_failure')
        }
        writePrivateFileAtomic(path, bytes)
      },
    })
    const writer = new MacroRunStore(root, undefined, () => createGeneratedId('run'), writerEvidence)
    const manifest = runManifest(writer.reserveRunId(), {
      schemaVersion: 6, name: 'stale summary', description: '', terminalLayout: [], body: [],
    })
    writer.publishManifest(manifest)
    writer.append(manifest.runId, 'run_started')
    writer.append(manifest.runId, 'step_completed')
    writer.append(manifest.runId, 'run_failed')

    const segmentReads: number[] = []
    let segmentLists = 0
    const coldEvidence = new EvidenceStore(root, undefined, {
      onSegmentRead: (_runId, start) => segmentReads.push(start),
      onSegmentList: () => { segmentLists += 1 },
    })
    const cold = new MacroRunStore(root, undefined, () => createGeneratedId('run'), coldEvidence)
    const first = cold.traceSummariesForRoom(manifest.runtime.roomId, 20, null).items[0]
    expect(first).toMatchObject({ status: 'failed', lastEventSeq: 3, totalEventCount: 3 })
    expect({ segmentReads, segmentLists }).toEqual({ segmentReads: [1], segmentLists: 1 })

    segmentReads.length = 0
    segmentLists = 0
    expect(cold.traceSummariesForRoom(manifest.runtime.roomId, 20, null).items[0])
      .toMatchObject({ status: 'failed', lastEventSeq: 3 })
    expect({ segmentReads, segmentLists }).toEqual({ segmentReads: [], segmentLists: 0 })
    expect(JSON.parse(readFileSync(join(root, 'runs', manifest.runId, 'summary.json'), 'utf8')))
      .toMatchObject({ lastEventKind: 'run_failed', lastEventSeq: 3 })
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('removing an unstarted manifest invalidates its derived Trace entry', () => {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-run-unstarted-034-'))
  try {
    const store = new MacroRunStore(root)
    const definition: MacroDefinitionV6 = { schemaVersion: 6, name: 'unstarted', description: '', terminalLayout: [], body: [] }
    const manifest = runManifest(store.reserveRunId(), definition)
    store.publishManifest(manifest)
    store.removeUnstarted(manifest.runId)
    expect(store.traceSummariesForRoom(manifest.runtime.roomId, 20, null)).toEqual({
      items: [],
      nextCursor: null,
    })
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('known Trace index add and remove never parse all manifests', () => {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-run-trace-index-034-'))
  try {
    const definition: MacroDefinitionV6 = {
      schemaVersion: 6, name: 'index scale', description: '', terminalLayout: [], body: [],
    }
    const seed = new MacroRunStore(root)
    for (let index = 0; index < 20; index += 1) {
      const manifest = runManifest(seed.reserveRunId(), definition)
      seed.publishManifest(manifest)
    }
    let manifestParses = 0
    const traceIndex = new MacroRunTraceIndex(seed.root, {
      manifestParse: () => { manifestParses += 1 },
    })
    const added = runManifest(createGeneratedId('run'), definition)
    writeManifestDirectory(seed.root, added)
    traceIndex.recordManifest(added)
    expect(manifestParses).toBe(0)
    expect(traceIndex.page(added.runtime.roomId, 50, null).entries.map((entry) => entry.runId))
      .toEqual([added.runId])

    rmSync(join(seed.root, added.runId), { recursive: true })
    traceIndex.removeRun(added.runId)
    expect(manifestParses).toBe(0)
    expect(traceIndex.page(added.runtime.roomId, 50, null).entries).toEqual([])

    const unindexed = runManifest(createGeneratedId('run'), definition)
    const known = runManifest(createGeneratedId('run'), definition)
    writeManifestDirectory(seed.root, unindexed)
    writeManifestDirectory(seed.root, known)
    traceIndex.recordManifest(known)
    expect(manifestParses).toBe(22)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('run reservation retries persistent ID collisions before publishing a manifest', () => {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-run-collision-034-'))
  try {
    const collision = createGeneratedId('run')
    const fresh = createGeneratedId('run')
    const first = new MacroRunStore(root, undefined, () => collision)
    expect(first.reserveRunId()).toBe(collision)

    const candidates = [collision, fresh]
    const second = new MacroRunStore(root, undefined, () => candidates.shift() ?? collision)
    expect(second.reserveRunId()).toBe(fresh)

    const exhausted = new MacroRunStore(root, undefined, () => collision)
    expect(() => exhausted.reserveRunId()).toThrow('run_id_collision')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('live run append uses one monotonic cursor instead of rereading the growing event log', () => {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-run-cursor-034-'))
  try {
    class CountingEvidenceStore extends EvidenceStore {
      readCount = 0
      override read(runId: string) {
        this.readCount += 1
        return super.read(runId)
      }
    }
    const evidence = new CountingEvidenceStore(root, () => '2026-07-15T00:00:00.000Z')
    const store = new MacroRunStore(root, () => '2026-07-15T00:00:00.000Z', () => createGeneratedId('run'), evidence)
    const definition: MacroDefinitionV6 = { schemaVersion: 6, name: 'cursor', description: '', terminalLayout: [], body: [] }
    const manifest = runManifest(store.reserveRunId(), definition)
    store.publishManifest(manifest)
    store.append(manifest.runId, 'run_started')
    for (let index = 0; index < 250; index += 1) store.append(manifest.runId, 'step_completed', { index })
    store.writeArtifact(manifest.runId, 'cursor', 'evidence')

    expect(evidence.readCount).toBe(0)
    const events = store.readEvents(manifest.runId)
    expect(evidence.readCount).toBe(1)
    expect(events).toHaveLength(251)
    expect(events.at(-1)).toMatchObject({ eventSeq: 251, data: { index: 249 } })
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('a committed event succeeds despite summary maintenance failure and the next intent advances normally', () => {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-run-idempotent-034-'))
  try {
    let failSummaryOnce = true
    let failPostPublishOnce = true
    const evidence = new EvidenceStore(root, () => '2026-07-15T00:00:00.000Z', {
      afterEventPublish(event) {
        if (event.eventSeq === 3 && failPostPublishOnce) {
          failPostPublishOnce = false
          throw new Error('synthetic_post_publish_fsync_failure')
        }
      },
      writeSummary(path, bytes) {
        const summary = JSON.parse(bytes) as { lastEventSeq: number }
        if (summary.lastEventSeq === 2 && failSummaryOnce) {
          failSummaryOnce = false
          throw new Error('synthetic_summary_publish_failure')
        }
        writePrivateFileAtomic(path, bytes)
      },
    })
    const store = new MacroRunStore(root, () => '2026-07-15T00:00:00.000Z', () => createGeneratedId('run'), evidence)
    const definition: MacroDefinitionV6 = { schemaVersion: 6, name: 'idempotent', description: '', terminalLayout: [], body: [] }
    const manifest = runManifest(store.reserveRunId(), definition)
    store.publishManifest(manifest)
    store.append(manifest.runId, 'run_started')

    const completed = store.append(manifest.runId, 'run_completed', { index: 1 })
    expect(completed.eventSeq).toBe(2)
    expect(store.readEvents(manifest.runId).map((event) => event.eventSeq)).toEqual([1, 2])

    const postPublish = store.append(manifest.runId, 'step_completed', { index: 2 })
    expect(postPublish.eventSeq).toBe(3)
    expect(store.readEvents(manifest.runId).map((event) => event.eventSeq)).toEqual([1, 2, 3])

    const segment = join(root, 'runs', manifest.runId, 'events', '000000000001.jsonl')
    appendFileSync(segment, '{"partial":')
    const afterPartial = store.append(manifest.runId, 'step_completed', { index: 3 })
    expect(afterPartial.eventSeq).toBe(4)
    expect(store.readEvents(manifest.runId).map((event) => event.eventSeq)).toEqual([1, 2, 3, 4])
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('run_started and an ordinary sequence checkpoint survive summary maintenance debt', () => {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-run-checkpoint-debt-034-'))
  try {
    const failedKinds = new Set(['run_started'])
    let failSequence100 = true
    const evidence = new EvidenceStore(root, () => '2026-07-15T00:00:00.000Z', {
      writeSummary(path, bytes) {
        const summary = JSON.parse(bytes) as { lastEventSeq: number; lastEventKind: string }
        if (failedKinds.delete(summary.lastEventKind)) throw new Error('synthetic_summary_maintenance_failure')
        if (summary.lastEventSeq === 100 && failSequence100) {
          failSequence100 = false
          throw new Error('synthetic_summary_maintenance_failure')
        }
        writePrivateFileAtomic(path, bytes)
      },
    })
    const store = new MacroRunStore(root, () => '2026-07-15T00:00:00.000Z', () => createGeneratedId('run'), evidence)
    const definition: MacroDefinitionV6 = { schemaVersion: 6, name: 'checkpoint debt', description: '', terminalLayout: [], body: [] }
    const manifest = runManifest(store.reserveRunId(), definition)
    store.publishManifest(manifest)
    expect(store.append(manifest.runId, 'run_started').eventSeq).toBe(1)
    for (let eventSeq = 2; eventSeq <= 100; eventSeq += 1) {
      expect(store.append(manifest.runId, 'step_completed', { eventSeq }).eventSeq).toBe(eventSeq)
    }
    expect(store.append(manifest.runId, 'step_completed', { eventSeq: 101 }).eventSeq).toBe(101)
    expect(store.readEventWindow(manifest.runId)).toMatchObject({ lastEventSeq: 101, totalEventCount: 101 })
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('durable evidence keeps only the latest 1000 absolute-sequence events and retains artifacts', () => {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-run-retention-034-'))
  try {
    let failPruneOnce = true
    const evidence = new EvidenceStore(root, () => '2026-07-15T00:00:00.000Z', {
      deleteSegment(path) {
        if (failPruneOnce) {
          failPruneOnce = false
          throw new Error('synthetic_prune_maintenance_failure')
        }
        return publishPrivateFileDelete(path)
      },
    })
    const store = new MacroRunStore(root, () => '2026-07-15T00:00:00.000Z', () => createGeneratedId('run'), evidence)
    const definition: MacroDefinitionV6 = { schemaVersion: 6, name: 'retention', description: '', terminalLayout: [], body: [] }
    const manifest = runManifest(store.reserveRunId(), definition)
    store.publishManifest(manifest)
    store.append(manifest.runId, 'run_started')
    const artifactRef = store.writeArtifact(manifest.runId, 'retained', 'artifact body')
    for (let index = 0; index < 1_099; index += 1) store.append(manifest.runId, 'step_completed', { index })

    const window = store.readEventWindow(manifest.runId)
    expect(window.events).toHaveLength(RUN_EVENT_RETENTION_LIMIT)
    expect(window.firstAvailableEventSeq).toBe(101)
    expect(window.lastEventSeq).toBe(1_100)
    expect(window.totalEventCount).toBe(1_100)
    expect(window.discardedEventCount).toBe(100)
    expect(window.events[0]?.eventSeq).toBe(101)
    expect(window.events.at(-1)?.eventSeq).toBe(1_100)
    expect(failPruneOnce).toBe(false)
    expect(readFileSync(join(root, 'runs', manifest.runId, artifactRef), 'utf8')).toBe('artifact body')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

function runManifest(runId: string, definition: MacroDefinitionV6): RunManifestV1 {
  return {
    schemaVersion: 1,
    runId,
    createdAt: '2026-07-15T00:00:00.000Z',
    macroRecord: { id: createGeneratedId('macroTemplate'), revision: 1 },
    definition,
    definitionHash: { algorithm: 'sha256', value: macroDefinitionHash(definition) },
    runtime: { serverInstanceId: createGeneratedId('serverInstance'), roomId: createGeneratedId('room'), roomGeneration: createGeneratedId('roomGeneration'), terminalStructureRevision: 0 },
    terminalBindings: [],
  }
}

function writeManifestDirectory(runsRoot: string, manifest: RunManifestV1): void {
  const directory = join(runsRoot, manifest.runId)
  mkdirSync(directory, { mode: 0o700 })
  writePrivateFileAtomic(join(directory, 'manifest.json'), JSON.stringify(manifest))
}
