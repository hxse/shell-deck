import { expect, test } from 'bun:test'
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  DEFAULT_LOG_STORAGE_LIMIT_BYTES,
  LogStorageRetention,
  resolveLogStorageLimitBytes,
} from '../../server/logStorageRetention'
import { startShellDeckServer } from '../../server/httpServer'
import { MacroRunStore } from '../../server/macroRunStore'
import { initializeUserDataRoot } from '../../server/userDataRoot'
import { AgentEventStore } from '../../src/lib/agentEvents/agentEventStore'
import { AGENT_EVENT_SEGMENT_TARGET_BYTES } from '../../src/lib/agentEvents/agentEventSegmentStorage'
import type { AgentEvent } from '../../src/lib/agentEvents/agentEventTypes'
import { createGeneratedId } from '../../src/lib/generatedId'
import type { RunManifestV1 } from '../../src/lib/macro/runnerTypes'

test('log quota defaults to 2 GiB, honors explicit/env values, and fixes the 90 percent target', () => {
  expect(resolveLogStorageLimitBytes(undefined, {})).toBe(DEFAULT_LOG_STORAGE_LIMIT_BYTES)
  expect(AGENT_EVENT_SEGMENT_TARGET_BYTES).toBe(8 * 1024 * 1024)
  expect(resolveLogStorageLimitBytes(undefined, { SHELL_DECK_LOG_STORAGE_LIMIT_BYTES: '1234' })).toBe(1234)
  expect(resolveLogStorageLimitBytes(4321, { SHELL_DECK_LOG_STORAGE_LIMIT_BYTES: '1234' })).toBe(4321)
  for (const value of ['', '   ', '0', '-1', '1.5', 'wat']) {
    expect(() => resolveLogStorageLimitBytes(undefined, { SHELL_DECK_LOG_STORAGE_LIMIT_BYTES: value }))
      .toThrow('invalid_log_storage_limit_bytes')
  }
  const root = temporaryRoot('config')
  try {
    const quota = new LogStorageRetention(root, { limitBytes: 101 })
    expect({ limit: quota.limitBytes, target: quota.targetBytes }).toEqual({ limit: 101, target: 90 })
    const largest = new LogStorageRetention(root, { limitBytes: 9_007_199_254_740_988 })
    expect(largest.targetBytes).toBe(8_106_479_329_266_889)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('quota removes the oldest terminalized whole run while preserving active evidence and MacroRecord bytes', () => {
  const root = temporaryRoot('runs')
  let now = '2026-07-25T00:00:00.000Z'
  try {
    const seed = new MacroRunStore(root, () => now)
    const roomId = createGeneratedId('room')
    const old = seedRun(seed, roomId, '2026-07-25T00:00:00.000Z', 8_000, 'run_completed', () => {
      now = '2026-07-25T00:01:00.000Z'
    })
    const staleSummaryPath = join(root, 'runs', old, 'summary.json')
    const staleSummary = JSON.parse(readFileSync(staleSummaryPath, 'utf8')) as Record<string, unknown>
    writeFileSync(staleSummaryPath, JSON.stringify({ ...staleSummary, lastEventKind: 'run_started' }) + '\n')
    const newer = seedRun(seed, roomId, '2026-07-25T00:02:00.000Z', 1_000, 'run_failed', () => {
      now = '2026-07-25T00:03:00.000Z'
    })
    const active = seedRun(seed, roomId, '2026-07-25T00:04:00.000Z', 1_000)
    const paths = initializeUserDataRoot(root)
    writeFileSync(join(paths.macros, 'excluded.json'), 'm'.repeat(50_000))
    const stalePin = join(paths.locks, 'log-storage-current-runs', old + '.json')
    mkdirSync(join(paths.locks, 'log-storage-current-runs'), { recursive: true })
    writeFileSync(stalePin, JSON.stringify({
      schemaVersion: 1,
      pid: 2_147_483_647,
      processStartTime: '1',
    }) + '\n')

    const before = treeBytes(paths.runs) + treeBytes(paths.agentEvents)
    const oldBytes = treeBytes(join(paths.runs, old))
    const quota = new LogStorageRetention(root, { limitBytes: before - Math.floor(oldBytes / 2) })
    const store = new MacroRunStore(root, undefined, undefined, undefined, quota)
    const sweep = quota.enforce()
    expect(existsSync(join(paths.locks, 'log-storage-gc.lock'))).toBe(true)

    expect(sweep.removedRunIds).toEqual([old])
    expect(existsSync(join(paths.runs, old))).toBe(false)
    expect(existsSync(join(paths.runs, newer))).toBe(true)
    expect(existsSync(join(paths.runs, active))).toBe(true)
    expect(readFileSync(join(paths.macros, 'excluded.json'), 'utf8')).toHaveLength(50_000)
    expect(existsSync(stalePin)).toBe(false)
    expect(store.traceSummariesForRoom(roomId, 50, null).items.map((item) => item.runId).sort())
      .toEqual([newer, active].sort())
    expect(readdirSync(paths.runs).some((name) => name.startsWith('.gc-run_'))).toBe(false)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('cold Trace rebuild is admitted atomically and rebuilds from the post-GC run set', () => {
  const root = temporaryRoot('trace-rebuild-gc')
  try {
    const roomId = createGeneratedId('room')
    const seed = new MacroRunStore(root)
    const removed = seedRun(
      seed,
      roomId,
      '2026-07-25T00:00:00.000Z',
      4_000,
      'run_completed',
    )
    const active = seedRun(seed, roomId, '2026-07-25T00:01:00.000Z', 0)
    const paths = initializeUserDataRoot(root)
    const indexPath = join(paths.runs, 'trace-index.json')
    rmSync(indexPath)
    const before = treeBytes(paths.runs) + treeBytes(paths.agentEvents)
    const quota = new LogStorageRetention(root, { limitBytes: before + 1 })
    const store = new MacroRunStore(root, undefined, undefined, undefined, quota)

    expect(store.traceSummariesForRoom(roomId, 50, null).items.map((item) => item.runId))
      .toEqual([active])
    expect(existsSync(join(paths.runs, removed))).toBe(false)
    expect(readFileSync(indexPath, 'utf8')).not.toContain(removed)
    expect(quota.usageBytes()).toBeLessThan(quota.limitBytes)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('cold Trace rebuild fails without publishing when protected bytes leave no quota', () => {
  const root = temporaryRoot('trace-rebuild-rejected')
  try {
    const roomId = createGeneratedId('room')
    const seed = new MacroRunStore(root)
    seedRun(seed, roomId, '2026-07-25T00:00:00.000Z', 0)
    const paths = initializeUserDataRoot(root)
    const indexPath = join(paths.runs, 'trace-index.json')
    rmSync(indexPath)
    const before = treeBytes(paths.runs) + treeBytes(paths.agentEvents)
    const quota = new LogStorageRetention(root, { limitBytes: before + 1 })
    const store = new MacroRunStore(root, undefined, undefined, undefined, quota)

    expect(() => store.traceSummariesForRoom(roomId, 50, null))
      .toThrow('log_storage_limit_reached')
    expect(existsSync(indexPath)).toBe(false)
    expect(quota.usageBytes()).toBe(before)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('quota prunes only oldest closed AgentEvent segments and fails when protected bytes fill the limit', () => {
  const root = temporaryRoot('segments')
  try {
    const paths = initializeUserDataRoot(root)
    const stream = join(paths.agentEvents, 'server', 'room', 'generation')
    mkdirSync(stream, { recursive: true })
    const oldest = join(stream, '000000000001.jsonl')
    const newer = join(stream, '000000000002.jsonl')
    const open = join(stream, '000000000003.open.jsonl')
    writeFileSync(oldest, 'a'.repeat(800))
    writeFileSync(newer, 'b'.repeat(800))
    writeFileSync(open, 'c'.repeat(800))
    utimesSync(oldest, new Date(1_000), new Date(1_000))
    utimesSync(newer, new Date(2_000), new Date(2_000))
    writeFileSync(join(paths.macros, 'excluded.json'), 'm'.repeat(20_000))

    const quota = new LogStorageRetention(root, { limitBytes: 2_000 })
    expect(quota.usageBytes()).toBe(2_400)
    const sweep = quota.enforce()
    expect(sweep.removedAgentSegments).toEqual([
      join('server', 'room', 'generation', '000000000001.jsonl'),
    ])
    expect(existsSync(oldest)).toBe(false)
    expect(existsSync(newer)).toBe(true)
    expect(existsSync(open)).toBe(true)

    rmSync(newer)
    writeFileSync(open, 'x'.repeat(2_000))
    expect(() => quota.enforce()).toThrow('log_storage_limit_reached')
    expect(existsSync(open)).toBe(true)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('AgentEvent rolling segments preserve cold indexes, close explicitly, and reject flat legacy logs', () => {
  const root = temporaryRoot('agent-rolling')
  try {
    const identity = agentIdentity()
    let segmentAdmissions = 0
    let closedStreams = 0
    const first = agentEvent(identity, 1)
    const lineBytes = Buffer.byteLength(JSON.stringify(first) + '\n')
    const store = new AgentEventStore(root, {
      segmentTargetBytes: lineBytes + 10,
      admitAppend: (_incomingBytes, publish) => {
        segmentAdmissions += 1
        return publish()
      },
      afterStreamClose: () => { closedStreams += 1 },
    })
    store.append(first)
    store.append(agentEvent(identity, 2))
    store.append(agentEvent(identity, 3))

    const stream = join(store.evidenceRoot, identity.serverInstanceId, identity.roomId, identity.roomGeneration)
    expect(readdirSync(stream).sort()).toEqual([
      '000000000001.jsonl',
      '000000000002.jsonl',
      '000000000003.open.jsonl',
    ])
    expect(segmentAdmissions).toBe(3)
    expect(new AgentEventStore(root).list(
      identity.serverInstanceId,
      identity.roomId,
      identity.roomGeneration,
    )).toHaveLength(3)

    const activePath = join(stream, '000000000003.open.jsonl')
    utimesSync(activePath, new Date(1_000), new Date(1_000))
    store.closeRoom(identity.serverInstanceId, identity.roomId, identity.roomGeneration)
    expect(readdirSync(stream).sort()).toEqual([
      '000000000001.jsonl',
      '000000000002.jsonl',
      '000000000003.jsonl',
    ])
    expect(closedStreams).toBe(1)
    expect(statSync(join(stream, '000000000003.jsonl')).mtimeMs).toBeGreaterThan(1_000)

    const legacy = agentIdentity()
    const legacyRoom = join(store.evidenceRoot, legacy.serverInstanceId, legacy.roomId)
    mkdirSync(legacyRoom, { recursive: true })
    const legacyPath = join(legacyRoom, legacy.roomGeneration + '.jsonl')
    writeFileSync(legacyPath, '{}\n')
    expect(() => new AgentEventStore(root).list(
      legacy.serverInstanceId,
      legacy.roomId,
      legacy.roomGeneration,
    )).toThrow('legacy_agent_event_log_unsupported:' + legacyPath)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('new run, artifact, AgentEvent segment, and server startup source keep fail-loud quota admission', () => {
  const root = temporaryRoot('admission')
  try {
    const identity = agentIdentity()
    const seed = new MacroRunStore(root)
    const active = seedRun(seed, identity.roomId, '2026-07-25T00:00:00.000Z', 0)
    const reserved = seed.reserveRunId()
    const paths = initializeUserDataRoot(root)
    const protectedDirectory = join(paths.agentEvents, 'protected')
    mkdirSync(protectedDirectory, { recursive: true })
    const protectedPath = join(protectedDirectory, '000000000001.open.jsonl')
    writeFileSync(protectedPath, 'x'.repeat(4_000))
    const limit = treeBytes(paths.runs) + treeBytes(paths.agentEvents)
    const quota = new LogStorageRetention(root, { limitBytes: limit })
    const store = new MacroRunStore(root, undefined, undefined, undefined, quota)

    expect(() => quota.enforce()).toThrow('log_storage_limit_reached')
    expect(() => store.reserveRunId()).toThrow('log_storage_limit_reached')
    expect(() => store.publishManifest(manifest(reserved, identity.roomId, '2026-07-25T00:01:00.000Z')))
      .toThrow('log_storage_limit_reached')
    expect(() => store.append(active, 'maintenance_probe', { payload: 'x'.repeat(1_000) }))
      .toThrow('log_storage_limit_reached')
    expect(store.readEvents(active)).toHaveLength(1)
    expect(() => store.writeArtifact(active, 'blocked', 'value')).toThrow('log_storage_limit_reached')
    const agentStore = new AgentEventStore(root, {
      admitAppend: (incomingBytes, publish) => quota.admitAndPublish(incomingBytes, publish),
    })
    expect(() => agentStore.append(agentEvent(identity, 1))).toThrow('log_storage_limit_reached')
    expect(existsSync(protectedPath)).toBe(true)
    expect(() => startShellDeckServer({
      accessMode: 'guest',
      listenMode: 'local',
      dataRoot: root,
      port: 0,
      logStorageLimitBytes: limit,
    })).toThrow('log_storage_limit_reached')

    const serverSource = readFileSync(resolve(import.meta.dir, '../../server/httpServer.ts'), 'utf8')
    expect(serverSource.indexOf('logStorage.enforce()')).toBeLessThan(serverSource.indexOf('Bun.serve<RoomSocketData>'))
  } finally { rmSync(root, { recursive: true, force: true }) }
})

function temporaryRoot(label: string): string {
  return mkdtempSync(join(tmpdir(), `shell-deck-20260725c-${label}-`))
}

function seedRun(
  store: MacroRunStore,
  roomId: string,
  createdAt: string,
  artifactBytes: number,
  terminalKind?: 'run_completed' | 'run_failed' | 'run_stopped',
  beforeTerminal: () => void = () => {},
): string {
  const runId = store.reserveRunId()
  store.publishManifest(manifest(runId, roomId, createdAt))
  store.append(runId, 'run_started')
  if (artifactBytes) store.writeArtifact(runId, 'payload', 'x'.repeat(artifactBytes))
  if (terminalKind) {
    beforeTerminal()
    store.append(runId, terminalKind)
    store.releaseLiveRun(runId)
  }
  return runId
}

function manifest(runId: string, roomId: string, createdAt: string): RunManifestV1 {
  return {
    schemaVersion: 1,
    runId,
    createdAt,
    macroRecord: { id: createGeneratedId('macroTemplate'), revision: 1 },
    definition: { schemaVersion: 6, name: 'quota', description: '', terminalLayout: [], body: [] },
    definitionHash: { algorithm: 'sha256', value: '0'.repeat(64) },
    runtime: {
      serverInstanceId: createGeneratedId('serverInstance'),
      roomId,
      roomGeneration: createGeneratedId('roomGeneration'),
      terminalStructureRevision: 0,
    },
    terminalBindings: [],
  }
}

function agentIdentity() {
  return {
    serverInstanceId: createGeneratedId('serverInstance'),
    roomId: createGeneratedId('room'),
    roomGeneration: createGeneratedId('roomGeneration'),
    terminalId: createGeneratedId('terminal'),
    launchId: createGeneratedId('terminalLaunch'),
  }
}

function agentEvent(identity: ReturnType<typeof agentIdentity>, index: number): AgentEvent {
  return {
    protocolVersion: 1,
    eventId: createGeneratedId('runEvent'),
    agentKind: 'codex',
    eventKind: 'agent.output',
    ...identity,
    receivedAt: `2026-07-25T00:00:${String(index).padStart(2, '0')}.000Z`,
    agentSessionId: 'session',
    agentTurnId: 'turn-' + index,
    adapterMetadata: { adapter: 'codex-stop-hook', codexSessionId: 'session' },
    capturedText: 'done-' + index,
    raw: { source: 'codex.Stop', payload: { index } },
  }
}

function treeBytes(root: string): number {
  if (!existsSync(root)) return 0
  let bytes = 0
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    bytes += entry.isDirectory() ? treeBytes(path) : statSync(path).size
  }
  return bytes
}
