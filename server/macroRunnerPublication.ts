import type { MacroRunnerDelta, MacroRunnerSnapshot } from '../src/lib/macro/runnerTypes'
import { macroRunnerStateHash } from './macroRunnerStateHash'
import type { MacroRunStore } from './macroRunStore'
import { liveRunRuntimeInput, type LiveRun } from './macroRunnerLiveState'
import type { TerminalRoomManager } from './terminalRoomManager'

export class MacroRunnerPublication {
  private readonly runtimeRevisions = new Map<string, number>()

  constructor(
    private readonly manager: TerminalRoomManager,
    private readonly runStore: MacroRunStore,
    private readonly currentRun: (roomId: string) => LiveRun | undefined,
  ) {}

  snapshot(roomId: string): MacroRunnerSnapshot {
    const room = this.manager.roomSummaryById(roomId)
    const run = this.currentRun(roomId)
    if (!run || run.roomGeneration !== room.roomGeneration) {
      return idleSnapshot(room.roomId, room.roomGeneration, this.runtimeRevisions.get(room.roomId) ?? 0)
    }
    const window = this.runStore.readEventWindow(run.runId)
    return {
      roomId: run.roomId,
      roomGeneration: run.roomGeneration,
      runtimeRevision: run.runtimeRevision,
      runId: run.runId,
      runningMacro: {
        recordId: run.recordId,
        recordRevision: run.recordRevision,
        definition: run.definition,
        definitionHash: run.definitionHash,
      },
      status: run.status,
      currentNodeId: run.currentNodeId,
      error: run.error,
      runtimeInput: liveRunRuntimeInput(run),
      ...window,
      stateHash: this.stateHash(run, window),
    }
  }

  nextRuntimeRevision(roomId: string): number {
    const revision = (this.runtimeRevisions.get(roomId) ?? 0) + 1
    this.runtimeRevisions.set(roomId, revision)
    return revision
  }

  bumpAndPublish(run: LiveRun): void {
    if (this.currentRun(run.roomId) !== run) return
    run.runtimeRevision = this.nextRuntimeRevision(run.roomId)
    this.schedulePublish(run)
  }

  publishSnapshot(run: LiveRun): void {
    try {
      const room = this.manager.roomSummaryById(run.roomId)
      if (room.roomGeneration !== run.roomGeneration || this.currentRun(run.roomId) !== run) return
      const window = this.runStore.readEventWindowView(run.runId)
      const canSendDelta = run.hasPublishedSnapshot
        && run.publishedEventSeq >= window.firstAvailableEventSeq - 1
      if (!canSendDelta) {
        const snapshot = this.snapshot(run.roomId)
        this.manager.broadcastRoomMessage(run.roomId, { type: 'runner_snapshot', snapshot })
      } else {
        const delta: MacroRunnerDelta = {
          roomId: run.roomId,
          roomGeneration: run.roomGeneration,
          runId: run.runId,
          definitionHash: run.definitionHash,
          expectedRuntimeRevision: run.publishedRuntimeRevision,
          runtimeRevision: run.runtimeRevision,
          status: run.status,
          currentNodeId: run.currentNodeId,
          error: run.error,
          runtimeInput: liveRunRuntimeInput(run),
          events: window.events.filter((event) => event.eventSeq > run.publishedEventSeq),
          firstAvailableEventSeq: window.firstAvailableEventSeq,
          lastEventSeq: window.lastEventSeq,
          totalEventCount: window.totalEventCount,
          discardedEventCount: window.discardedEventCount,
          stateHash: this.stateHash(run, window),
        }
        this.manager.broadcastRoomMessage(run.roomId, { type: 'runner_delta', delta })
      }
      run.hasPublishedSnapshot = true
      run.publishedEventSeq = window.lastEventSeq
      run.publishedRuntimeRevision = run.runtimeRevision
    } catch {
      // Destroy closes mutation admission and owns final client teardown.
    } finally {
      if (run.terminalized) this.runStore.releaseLiveRun(run.runId)
    }
  }

  clearPublishTimer(run: LiveRun): void {
    if (run.publishTimer) clearTimeout(run.publishTimer)
  }

  deleteRuntimeRevision(roomId: string): void {
    this.runtimeRevisions.delete(roomId)
  }

  private schedulePublish(run: LiveRun): void {
    if (run.publishTimer) return
    run.publishTimer = setTimeout(() => {
      run.publishTimer = null
      this.publishSnapshot(run)
    }, 25)
    run.publishTimer.unref?.()
  }

  private stateHash(run: LiveRun, window: Readonly<ReturnType<MacroRunStore['readEventWindow']>>): string {
    return macroRunnerStateHash({
      runId: run.runId,
      definitionHash: run.definitionHash,
      status: run.status,
      currentNodeId: run.currentNodeId,
      error: run.error,
      runtimeInput: liveRunRuntimeInput(run),
      events: window.events,
      firstAvailableEventSeq: window.firstAvailableEventSeq,
      lastEventSeq: window.lastEventSeq,
      totalEventCount: window.totalEventCount,
      discardedEventCount: window.discardedEventCount,
    })
  }
}

function idleSnapshot(roomId: string, roomGeneration: string, runtimeRevision: number): MacroRunnerSnapshot {
  const snapshot: MacroRunnerSnapshot = {
    roomId,
    roomGeneration,
    runtimeRevision,
    runId: null,
    runningMacro: null,
    status: 'idle',
    currentNodeId: null,
    error: null,
    runtimeInput: null,
    events: [],
    firstAvailableEventSeq: 0,
    lastEventSeq: 0,
    totalEventCount: 0,
    discardedEventCount: 0,
    stateHash: '',
  }
  snapshot.stateHash = macroRunnerStateHash({
    ...snapshot,
    definitionHash: null,
  })
  return snapshot
}
