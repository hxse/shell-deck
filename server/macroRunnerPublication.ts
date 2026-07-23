import type { MacroRunnerDelta, MacroRunnerSnapshot } from '../src/lib/macro/runnerTypes'
import type { MacroRunStore } from './macroRunStore'
import type { LiveRun } from './macroRunnerLiveState'
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
    return {
      roomId: run.roomId,
      roomGeneration: run.roomGeneration,
      runtimeRevision: run.runtimeRevision,
      runId: run.runId,
      runningMacro: {
        recordId: run.recordId,
        recordRevision: run.recordRevision,
        definition: structuredClone(run.definition),
      },
      status: run.status,
      currentNodeId: run.currentNodeId,
      error: run.error,
      runtimeInput: run.pendingInput ? {
        invocationId: run.pendingInput.invocationId,
        prompt: run.pendingInput.prompt,
        defaultText: run.pendingInput.defaultText,
        draft: run.pendingInput.draft,
        inputRevision: run.pendingInput.inputRevision,
        status: 'waiting',
      } : null,
      ...this.runStore.readEventWindow(run.runId),
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
      const snapshot = this.snapshot(run.roomId)
      const canSendDelta = run.publishedEventSeq >= snapshot.firstAvailableEventSeq - 1
      if (!canSendDelta) {
        this.manager.broadcastRoomMessage(run.roomId, { type: 'runner_snapshot', snapshot })
      } else {
        const delta: MacroRunnerDelta = {
          ...snapshot,
          events: snapshot.events.filter((event) => event.eventSeq > run.publishedEventSeq),
        }
        this.manager.broadcastRoomMessage(run.roomId, { type: 'runner_delta', delta })
      }
      run.publishedEventSeq = snapshot.lastEventSeq
    } catch {
      // Destroy closes mutation admission and owns final client teardown.
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
}

function idleSnapshot(roomId: string, roomGeneration: string, runtimeRevision: number): MacroRunnerSnapshot {
  return {
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
  }
}
