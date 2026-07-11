import { expect, test } from "bun:test"
import type { AgentEvent } from "../../src/lib/agentEvents/agentEventTypes"
import {
  artifactInvocationCandidates,
  createMacroExecutionCursor,
  executionPathData,
  forIterationContext,
  invocationKey,
  parallelLaneContext,
  parallelLaneKey,
  pruneCompletedExecutionScope,
  restoreMacroExecutionCursor,
  rootExecutionContext,
  sequenceKey,
  snapshotMacroExecutionCursor,
} from "../../server/macroExecutionCursor"

function textListItem(value: string, key = value) {
  return { key, value }
}

test("execution contexts inherit and shadow immutable template bindings lexically", () => {
  const root = rootExecutionContext()
  const outer = forIterationContext(root, "outer_loop", 1, textListItem(" outer\n", "outer-key"))
  const counted = forIterationContext(outer, "count_loop", 2, undefined)
  const shadowed = forIterationContext(counted, "inner_loop", 0, textListItem("inner"))
  const lane = parallelLaneContext(shadowed, "parallel_review", "worker_lane")

  expect(root).toEqual({ executionPath: [] })
  expect(outer.templateBinding).toEqual({ index: 2, key: "outer-key", value: " outer\n", forStepId: "outer_loop" })
  expect(counted.templateBinding).toEqual(outer.templateBinding)
  expect(shadowed.templateBinding).toEqual({ index: 1, key: "inner", value: "inner", forStepId: "inner_loop" })
  expect(lane.templateBinding).toEqual(shadowed.templateBinding)
  expect(outer.executionPath).toEqual([{ kind: "for", stepId: "outer_loop", iterationIndex: 1 }])
  expect(counted.executionPath).toHaveLength(2)
  expect(root.executionPath).toEqual([])
})

test("invocation and sequence keys distinguish iterations and parallel lanes", () => {
  const root = rootExecutionContext()
  const first = forIterationContext(root, "loop", 0, textListItem("first"))
  const second = forIterationContext(root, "loop", 1, textListItem("second"))
  const laneA = parallelLaneContext(first, "parallel", "lane_a")
  const laneB = parallelLaneContext(first, "parallel", "lane_b")

  expect(invocationKey(root, "send")).not.toBe(invocationKey(first, "send"))
  expect(invocationKey(first, "send")).not.toBe(invocationKey(second, "send"))
  expect(invocationKey(laneA, "send")).not.toBe(invocationKey(laneB, "send"))
  expect(sequenceKey(first, "loop-body")).not.toBe(sequenceKey(second, "loop-body"))
  expect(parallelLaneKey(first, "parallel", "lane_a")).not.toBe(parallelLaneKey(first, "parallel", "lane_b"))
})

test("artifact lookup candidates inherit lexical predecessors without crossing lane or iteration siblings", () => {
  const root = rootExecutionContext()
  const outer = forIterationContext(root, "outer_loop", 1, textListItem("outer"))
  const previous = forIterationContext(root, "outer_loop", 0, textListItem("previous"))
  const lane = parallelLaneContext(outer, "parallel", "lane_b")
  const siblingLane = parallelLaneContext(outer, "parallel", "lane_a")

  expect(artifactInvocationCandidates(lane, "capture")).toEqual([
    invocationKey(lane, "capture"),
    invocationKey(outer, "capture"),
    invocationKey(root, "capture"),
  ])
  expect(artifactInvocationCandidates(lane, "capture")).not.toContain(invocationKey(siblingLane, "capture"))
  expect(artifactInvocationCandidates(lane, "capture")).not.toContain(invocationKey(previous, "capture"))
})

test("event path data is detached and cursor collections are per run", () => {
  const context = forIterationContext(rootExecutionContext(), "loop", 0, textListItem("item"))
  const eventPath = executionPathData(context)
  ;(eventPath[0] as { iterationIndex: number }).iterationIndex = 99
  expect(context.executionPath[0]).toEqual({ kind: "for", stepId: "loop", iterationIndex: 0 })

  const first = createMacroExecutionCursor()
  const second = createMacroExecutionCursor()
  first.sequenceIndexes.set("root", 2)
  first.completedInvocations.add("send")
  expect(second.sequenceIndexes.size).toBe(0)
  expect(second.completedInvocations.size).toBe(0)
})

test("completed iteration scope pruning removes descendant continuation state and preserves siblings", () => {
  const cursor = createMacroExecutionCursor()
  const root = rootExecutionContext()
  const completed = forIterationContext(root, "forever_loop", 7, undefined)
  const sibling = forIterationContext(root, "forever_loop", 8, undefined)
  const completedInvocation = invocationKey(completed, "action")
  const siblingInvocation = invocationKey(sibling, "action")
  const completedSequence = sequenceKey(completed, "for:forever_loop")
  const siblingSequence = sequenceKey(sibling, "for:forever_loop")
  const completedLane = parallelLaneKey(completed, "parallel_action", "lane_a")
  const siblingLane = parallelLaneKey(sibling, "parallel_action", "lane_a")
  const completedBaseline = completedInvocation + "|term_worker|agent.output|codex-stop-hook"
  const siblingBaseline = siblingInvocation + "|term_worker|agent.output|codex-stop-hook"

  cursor.startedInvocations.add(completedInvocation)
  cursor.startedInvocations.add(siblingInvocation)
  cursor.completedInvocations.add(completedInvocation)
  cursor.completedInvocations.add(siblingInvocation)
  cursor.completedParallelLanes.add(completedLane)
  cursor.completedParallelLanes.add(siblingLane)
  cursor.sequenceIndexes.set(completedSequence, 3)
  cursor.sequenceIndexes.set(siblingSequence, 1)
  cursor.branchSelections.set(completedInvocation, "else")
  cursor.branchSelections.set(siblingInvocation, "none")
  cursor.loopIterations.set(completedInvocation, 4)
  cursor.loopIterations.set(siblingInvocation, 2)
  cursor.waitStates.set(completedInvocation, { mode: "duration", remainingMs: 25 })
  cursor.waitStates.set(siblingInvocation, { mode: "duration", remainingMs: 50 })
  cursor.artifactRefs.set(completedInvocation, new Map([["captured_text", "completed-artifact"]]))
  cursor.artifactRefs.set(siblingInvocation, new Map([["captured_text", "sibling-artifact"]]))
  cursor.agentEventBaselines.set(completedBaseline, 4)
  cursor.agentEventBaselines.set(siblingBaseline, 5)
  cursor.agentEventCaptureStates.set(completedInvocation, { remainingMs: 10 })
  cursor.agentEventCaptureStates.set(siblingInvocation, { remainingMs: 20 })
  cursor.notificationStates.set(completedInvocation, {
    notificationId: "notif_completed",
    createdAt: "2026-07-11T00:00:00.000Z",
    title: "completed",
    message: "completed",
    messageArtifactRef: "completed-notification",
    requested: true,
    browserDelivered: true,
    deliveredTelegramProfiles: new Set(["profile-a"]),
  })
  cursor.notificationStates.set(siblingInvocation, {
    notificationId: "notif_sibling",
    createdAt: "2026-07-11T00:00:01.000Z",
    title: "sibling",
    message: "sibling",
    messageArtifactRef: "sibling-notification",
    requested: false,
    browserDelivered: false,
    deliveredTelegramProfiles: new Set(),
  })

  pruneCompletedExecutionScope(cursor, completed)

  expect(cursor.startedInvocations).toEqual(new Set([siblingInvocation]))
  expect(cursor.completedInvocations).toEqual(new Set([siblingInvocation]))
  expect(cursor.completedParallelLanes).toEqual(new Set([siblingLane]))
  expect(cursor.sequenceIndexes).toEqual(new Map([[siblingSequence, 1]]))
  expect(cursor.branchSelections).toEqual(new Map([[siblingInvocation, "none"]]))
  expect(cursor.loopIterations).toEqual(new Map([[siblingInvocation, 2]]))
  expect(cursor.waitStates.has(completedInvocation)).toBe(false)
  expect(cursor.waitStates.has(siblingInvocation)).toBe(true)
  expect(cursor.artifactRefs.has(completedInvocation)).toBe(false)
  expect(cursor.artifactRefs.has(siblingInvocation)).toBe(true)
  expect(cursor.agentEventBaselines).toEqual(new Map([[siblingBaseline, 5]]))
  expect(cursor.agentEventCaptureStates.has(completedInvocation)).toBe(false)
  expect(cursor.agentEventCaptureStates.has(siblingInvocation)).toBe(true)
  expect(cursor.notificationStates.has(completedInvocation)).toBe(false)
  expect(cursor.notificationStates.has(siblingInvocation)).toBe(true)
})

test("cursor snapshot round-trips every continuation payload and restores detached state", () => {
  const cursor = createMacroExecutionCursor()
  const context = forIterationContext(rootExecutionContext(), "text_loop", 1, textListItem("current item"))
  const capturedEvent: AgentEvent = {
    protocolVersion: 1,
    agentKind: "codex",
    eventKind: "agent.output",
    configId: "local",
    terminalId: "term_worker",
    launchId: "launch_cursor_snapshot",
    agentSessionId: "session_cursor_snapshot",
    agentTurnId: "turn_cursor_snapshot",
    adapterMetadata: { adapter: "codex-stop-hook", codexSessionId: "codex_cursor_snapshot" },
    capturedText: "captured result",
    raw: { source: "codex.Stop", payload: { hook_event_name: "Stop" } },
    receivedAt: "2026-07-11T00:00:00.000Z",
  }

  cursor.sequenceIndexes.set("root", 3)
  cursor.startedInvocations.add("started")
  cursor.completedInvocations.add("completed")
  cursor.branchSelections.set("if", "else")
  cursor.loopIterations.set("loop", 2)
  cursor.completedParallelLanes.add("lane")
  cursor.waitStates.set("duration", { mode: "duration", remainingMs: 125 })
  cursor.waitStates.set("quiet", { mode: "terminal-quiet", remainingMs: 500, quietElapsedMs: 75, lastReplay: "output" })
  cursor.waitStates.set("manual", { mode: "user-continue", continueRequested: true })
  cursor.waitingInputExecution = {
    node: {
      id: "input_item",
      type: "input",
      terminal: { kind: "alias", value: "worker" },
      prompt: { kind: "template", template: "Input {{value}}" },
      allowEmpty: false,
      enter: false,
    },
    context,
  }
  cursor.waitingContinueExecution = {
    node: {
      id: "continue_item",
      type: "wait",
      mode: "user-continue",
      prompt: { kind: "template", template: "Continue {{value}}" },
    },
    context,
  }
  cursor.artifactRefs.set(invocationKey(context, "capture_item"), new Map([
    ["captured_text", "runs/run_cursor/artifacts/captured.txt"],
    ["extracted_text", "runs/run_cursor/artifacts/extracted.txt"],
  ]))
  cursor.consumedAgentEvents.add("agent-event-key")
  cursor.agentEventBaselines.set("capture-baseline", 4)
  cursor.agentEventCaptureStates.set("capture-state", {
    remainingMs: 321,
    captured: {
      text: "captured result",
      raw: { nested: { value: "raw" } },
      events: [capturedEvent],
      turnId: "turn_cursor_snapshot",
      sessionId: "session_cursor_snapshot",
      codexSessionId: "codex_cursor_snapshot",
    },
  })
  cursor.notificationStates.set("notify-state", {
    notificationId: "notif_cursor_snapshot",
    createdAt: "2026-07-11T00:00:01.000Z",
    title: "Title current item",
    message: "Message current item",
    messageArtifactRef: "runs/run_cursor/artifacts/notification.txt",
    requested: true,
    browserDelivered: true,
    deliveredTelegramProfiles: new Set(["profile-a"]),
  })

  const json = JSON.stringify(snapshotMacroExecutionCursor(cursor))
  const restored = restoreMacroExecutionCursor(JSON.parse(json))

  expect(snapshotMacroExecutionCursor(restored)).toEqual(snapshotMacroExecutionCursor(cursor))

  const restoredDuration = restored.waitStates.get("duration")
  if (restoredDuration?.mode !== "duration") throw new Error("duration wait state missing")
  restoredDuration.remainingMs = 1
  expect(cursor.waitStates.get("duration")).toEqual({ mode: "duration", remainingMs: 125 })

  const restoredInput = restored.waitingInputExecution
  if (!restoredInput || typeof restoredInput.node.prompt === "string") throw new Error("input cursor missing")
  restoredInput.node.prompt.template = "changed input"
  ;(restoredInput.context.executionPath[0] as { iterationIndex: number }).iterationIndex = 99
  const restoredBinding = restoredInput.context.templateBinding as { index: number; key: string; value: string } | undefined
  if (!restoredBinding) throw new Error("restored template binding missing")
  restoredBinding.index = 9
  restoredBinding.key = "changed key"
  restoredBinding.value = "changed value"
  const originalInput = cursor.waitingInputExecution
  if (!originalInput || typeof originalInput.node.prompt === "string") throw new Error("original input cursor missing")
  expect(originalInput.node.prompt.template).toBe("Input {{value}}")
  expect(originalInput.context.executionPath[0]).toEqual({ kind: "for", stepId: "text_loop", iterationIndex: 1 })
  expect(originalInput.context.templateBinding).toEqual({ index: 2, key: "current item", value: "current item", forStepId: "text_loop" })

  restored.artifactRefs.get(invocationKey(context, "capture_item"))?.set("captured_text", "changed-artifact")
  expect(cursor.artifactRefs.get(invocationKey(context, "capture_item"))?.get("captured_text")).toBe("runs/run_cursor/artifacts/captured.txt")

  const restoredCapture = restored.agentEventCaptureStates.get("capture-state")?.captured
  if (!restoredCapture) throw new Error("agent capture cursor missing")
  restoredCapture.text = "changed capture"
  restoredCapture.events[0].capturedText = "changed event"
  ;((restoredCapture.raw as { nested: { value: string } }).nested.value) = "changed raw"
  const originalCapture = cursor.agentEventCaptureStates.get("capture-state")?.captured
  expect(originalCapture?.text).toBe("captured result")
  expect(originalCapture?.events[0].capturedText).toBe("captured result")
  expect((originalCapture?.raw as { nested: { value: string } }).nested.value).toBe("raw")

  restored.notificationStates.get("notify-state")?.deliveredTelegramProfiles.add("profile-b")
  expect(cursor.notificationStates.get("notify-state")?.deliveredTelegramProfiles).toEqual(new Set(["profile-a"]))
})
