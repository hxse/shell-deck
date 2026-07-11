import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, test } from "bun:test"
import { AgentEventStore } from "../../src/lib/agentEvents/agentEventStore"
import type { AgentEvent } from "../../src/lib/agentEvents/agentEventTypes"
import { MacroTemplateStore } from "../../src/lib/macro/templateStore"
import type { MacroTemplate } from "../../src/lib/macro/templateTypes"
import { RunEventStore } from "../../src/lib/runLog/runEventStore"
import { MacroRunnerService } from "../../server/macroRunnerService"
import type { NotificationDispatcher, TelegramNotificationResult } from "../../server/notificationService"
import { TerminalDeckManager } from "../../server/terminalDeckManager"

const worker = { kind: "alias" as const, value: "worker" }
const reviewer = { kind: "alias" as const, value: "reviewer" }
const collector = { kind: "alias" as const, value: "collector" }

function harness(notificationService?: NotificationDispatcher) {
  const root = mkdtempSync(join(tmpdir(), "shell-deck-runner-resume-cursor-"))
  const manager = new TerminalDeckManager()
  manager.createTerminal("local", { backend: "fake", terminalAlias: "worker" })
  manager.createTerminal("local", { backend: "fake", terminalAlias: "reviewer" })
  manager.createTerminal("local", { backend: "text", terminalAlias: "collector" })
  const runStore = new RunEventStore(root)
  const templateStore = new MacroTemplateStore(root)
  const agentStore = new AgentEventStore(root)
  const service = new MacroRunnerService(manager, templateStore, runStore, agentStore, undefined, notificationService)
  return {
    root,
    manager,
    runStore,
    templateStore,
    agentStore,
    service,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  }
}

type Harness = ReturnType<typeof harness>

function template(id: string, body: MacroTemplate["body"]): MacroTemplate {
  const now = "2026-01-01T00:00:00.000Z"
  return {
    schemaVersion: 2,
    id,
    name: id,
    description: "",
    configId: "local",
    body,
    createdAt: now,
    updatedAt: now,
  }
}

function nestedArtifactRef(event: { data: Record<string, unknown> } | undefined): string {
  const value = event?.data.content
  if (!value || typeof value !== "object" || !("artifactRef" in value)) return ""
  return String((value as { artifactRef: unknown }).artifactRef)
}

function sentContents(h: Harness, stepId: string): string[] {
  const snapshot = h.service.snapshot("local")
  const runId = String(snapshot.runId)
  return (snapshot.run?.replay.events ?? [])
    .filter((event) => event.kind === "terminal_text_sent" && event.stepId === stepId)
    .map((event) => h.runStore.readArtifact("local", runId, nestedArtifactRef(event)))
}

function events(h: Harness) {
  return h.service.snapshot("local").run?.replay.events ?? []
}

test("agent-event capture pause/resume keeps the current iteration and consumes each event once", async () => {
  const previousTimeout = process.env.SHELL_DECK_AGENT_EVENT_CAPTURE_TIMEOUT_MS
  process.env.SHELL_DECK_AGENT_EVENT_CAPTURE_TIMEOUT_MS = "1500"
  const h = harness()
  try {
    const reviewerId = h.manager.deckSnapshot("local").terminals.find((terminal) => terminal.terminalAlias === "reviewer")?.terminalId
    if (!reviewerId) throw new Error("missing reviewer terminal")
    h.agentStore.append(agentOutput({ terminalId: reviewerId, text: "stale-result", turnId: "turn-stale", receivedAt: "2026-07-11T00:59:59.000Z" }))
    h.templateStore.save("local", template("agent_capture_resume_cursor", [
      {
        id: "loop",
        type: "for",
        range: { kind: "text-list", items: ["A", "B"] },
        body: [
          { id: "before_agent", type: "send", terminal: worker, message: { parts: [{ kind: "template", template: "before={{text}}" }] }, enter: false },
          { id: "capture_agent", type: "capture-source", capture: { kind: "agent-event", agent: { kind: "codex" }, terminal: reviewer, captureMode: "result_only" } },
          { id: "forward_agent", type: "send", terminal: worker, message: { parts: [{ kind: "artifact", source: { kind: "step_artifact", stepId: "capture_agent", artifact: "captured_text" } }] }, enter: false },
        ],
      },
    ]), h.manager.indexMap("local"))

    await h.service.start("local", { templateId: "agent_capture_resume_cursor" })
    await waitFor(() => events(h).filter((event) => event.kind === "capture_wait_started" && event.stepId === "capture_agent").length === 1)
    await h.service.pause("local")
    await Bun.sleep(130)
    const firstEvent = agentOutput({ terminalId: reviewerId, text: "result-A", turnId: "turn-a", receivedAt: "2026-07-11T01:00:00.000Z" })
    h.agentStore.append(firstEvent)
    await Bun.sleep(130)

    expect(h.service.snapshot("local").status).toBe("paused")
    expect(sentContents(h, "before_agent")).toEqual(["before=A"])
    expect(events(h).filter((event) => event.kind === "capture_artifact_created" && event.stepId === "capture_agent")).toHaveLength(0)

    await h.service.resume("local")
    await waitFor(() => events(h).filter((event) => event.kind === "capture_wait_started" && event.stepId === "capture_agent").length === 2)
    expect(sentContents(h, "before_agent")).toEqual(["before=A", "before=B"])
    expect(sentContents(h, "forward_agent")).toEqual(["result-A"])

    h.agentStore.append(structuredClone(firstEvent))
    await Bun.sleep(130)
    expect(h.service.snapshot("local").status).toBe("running")
    expect(sentContents(h, "forward_agent")).toEqual(["result-A"])
    expect(events(h).filter((event) => event.kind === "capture_artifact_created" && event.stepId === "capture_agent").map((event) => event.data.agentTurnId)).toEqual(["turn-a"])

    h.agentStore.append(agentOutput({ terminalId: reviewerId, text: "result-B", turnId: "turn-b", receivedAt: "2026-07-11T01:00:01.000Z" }))
    await waitFor(() => h.service.snapshot("local").status === "completed", 3000)

    expect(sentContents(h, "before_agent")).toEqual(["before=A", "before=B"])
    expect(sentContents(h, "forward_agent")).toEqual(["result-A", "result-B"])
    expect(events(h).filter((event) => event.kind === "capture_wait_started" && event.stepId === "capture_agent")).toHaveLength(2)
    expect(events(h).filter((event) => event.kind === "capture_artifact_created" && event.stepId === "capture_agent").map((event) => event.data.agentTurnId)).toEqual(["turn-a", "turn-b"])
  } finally {
    if (previousTimeout === undefined) delete process.env.SHELL_DECK_AGENT_EVENT_CAPTURE_TIMEOUT_MS
    else process.env.SHELL_DECK_AGENT_EVENT_CAPTURE_TIMEOUT_MS = previousTimeout
    const runtime = (h.service as unknown as { runtimes: Map<string, { cursor: { consumedAgentEvents: Set<string> } }> }).runtimes.get("local")
    expect(runtime?.cursor.consumedAgentEvents.size).toBe(0)
    h.cleanup()
  }
})

test("prompt-and-result capture preserves an unconsumed out-of-order pair behind the high-water hole", async () => {
  const previousTimeout = process.env.SHELL_DECK_AGENT_EVENT_CAPTURE_TIMEOUT_MS
  process.env.SHELL_DECK_AGENT_EVENT_CAPTURE_TIMEOUT_MS = "1500"
  const h = harness()
  try {
    const reviewerId = h.manager.deckSnapshot("local").terminals.find((terminal) => terminal.terminalAlias === "reviewer")?.terminalId
    if (!reviewerId) throw new Error("missing reviewer terminal")
    h.templateStore.save("local", template("agent_pair_high_water_hole", [
      {
        id: "pair_loop",
        type: "for",
        range: { kind: "count", count: 2 },
        body: [
          { id: "capture_pair", type: "capture-source", capture: { kind: "agent-event", agent: { kind: "codex" }, terminal: reviewer, captureMode: "prompt_and_result" } },
          { id: "forward_pair", type: "send", terminal: worker, message: { parts: [{ kind: "artifact", source: { kind: "step_artifact", stepId: "capture_pair", artifact: "captured_text" } }] }, enter: false },
        ],
      },
    ]), h.manager.indexMap("local"))

    await h.service.start("local", { templateId: "agent_pair_high_water_hole" })
    await waitFor(() => events(h).some((event) => event.kind === "capture_wait_started" && event.stepId === "capture_pair"))

    h.agentStore.append(agentPrompt({ terminalId: reviewerId, text: "prompt-A", turnId: "turn-a", receivedAt: "2026-07-11T02:00:00.000Z" }))
    h.agentStore.append(agentPrompt({ terminalId: reviewerId, text: "prompt-B", turnId: "turn-b", receivedAt: "2026-07-11T02:00:01.000Z" }))
    h.agentStore.append(agentOutput({ terminalId: reviewerId, text: "result-B", turnId: "turn-b", receivedAt: "2026-07-11T02:00:02.000Z" }))
    h.agentStore.append(agentOutput({ terminalId: reviewerId, text: "result-A", turnId: "turn-a", receivedAt: "2026-07-11T02:00:03.000Z" }))

    await waitFor(() => h.service.snapshot("local").status === "completed", 3000)

    expect(events(h).filter((event) => event.kind === "capture_artifact_created" && event.stepId === "capture_pair").map((event) => event.data.agentTurnId)).toEqual(["turn-a", "turn-b"])
    expect(sentContents(h, "forward_pair")).toEqual([
      "===== user prompt =====\nprompt-A\n\n===== assistant result =====\nresult-A",
      "===== user prompt =====\nprompt-B\n\n===== assistant result =====\nresult-B",
    ])
  } finally {
    if (previousTimeout === undefined) delete process.env.SHELL_DECK_AGENT_EVENT_CAPTURE_TIMEOUT_MS
    else process.env.SHELL_DECK_AGENT_EVENT_CAPTURE_TIMEOUT_MS = previousTimeout
    h.cleanup()
  }
})

test("terminal-quiet pause freezes its timeout budget and resumes observation after paused output", async () => {
  const h = harness()
  try {
    h.templateStore.save("local", template("terminal_quiet_resume_cursor", [
      {
        id: "loop",
        type: "for",
        range: { kind: "text-list", items: ["quiet-item"] },
        body: [
          { id: "before_quiet", type: "send", terminal: worker, message: { parts: [{ kind: "template", template: "before={{text}}" }] }, enter: false },
          { id: "quiet_wait", type: "wait", mode: "terminal-quiet", terminal: worker, quietMs: 80, maxMs: 220, onTimeout: "pause" },
          { id: "after_quiet", type: "send", terminal: worker, message: { parts: [{ kind: "template", template: "after={{text}}" }] }, enter: false },
        ],
      },
    ]), h.manager.indexMap("local"))

    await h.service.start("local", { templateId: "terminal_quiet_resume_cursor" })
    await waitFor(() => events(h).some((event) => event.kind === "wait_started" && event.stepId === "quiet_wait"))
    await h.service.pause("local")
    await Bun.sleep(130)
    const pausedWrite = h.manager.input("local", worker, "output-during-pause")
    expect(pausedWrite.ok).toBe(true)
    await Bun.sleep(260)

    expect(h.service.snapshot("local").status).toBe("paused")
    expect(sentContents(h, "before_quiet")).toEqual(["before=quiet-item"])
    expect(events(h).some((event) => event.kind === "wait_timeout" && event.stepId === "quiet_wait")).toBe(false)

    await h.service.resume("local")
    await waitFor(() => h.service.snapshot("local").status === "completed", 2000)

    expect(sentContents(h, "before_quiet")).toEqual(["before=quiet-item"])
    expect(sentContents(h, "after_quiet")).toEqual(["after=quiet-item"])
    expect(events(h).filter((event) => event.kind === "wait_started" && event.stepId === "quiet_wait")).toHaveLength(1)
    expect(events(h).filter((event) => event.kind === "wait_completed" && event.stepId === "quiet_wait")).toHaveLength(1)
    expect(events(h).some((event) => event.kind === "wait_timeout" && event.stepId === "quiet_wait")).toBe(false)
  } finally {
    h.cleanup()
  }
})

test("nested count loops resume an interrupted dynamic occurrence without repeating side effects", async () => {
  const h = harness()
  try {
    h.templateStore.save("local", template("nested_count_resume_cursor", [
      {
        id: "outer_count",
        type: "for",
        range: { kind: "count", count: 2 },
        body: [
          {
            id: "inner_count",
            type: "for",
            range: { kind: "count", count: 2 },
            body: [
              { id: "nested_before", type: "send", terminal: worker, message: { parts: [{ kind: "text", text: "nested-before" }] }, enter: false },
              { id: "nested_wait", type: "wait", mode: "duration", durationMs: 120 },
              { id: "nested_after", type: "send", terminal: worker, message: { parts: [{ kind: "text", text: "nested-after" }] }, enter: false },
            ],
          },
        ],
      },
    ]), h.manager.indexMap("local"))

    await h.service.start("local", { templateId: "nested_count_resume_cursor" })
    await waitFor(() => events(h).some((event) => event.kind === "wait_started" && event.stepId === "nested_wait"))
    await h.service.pause("local")
    await Bun.sleep(80)

    expect(sentContents(h, "nested_before")).toEqual(["nested-before"])
    expect(sentContents(h, "nested_after")).toEqual([])

    await h.service.resume("local")
    await waitFor(() => h.service.snapshot("local").status === "completed", 3000)

    expect(sentContents(h, "nested_before")).toEqual([
      "nested-before",
      "nested-before",
      "nested-before",
      "nested-before",
    ])
    expect(sentContents(h, "nested_after")).toEqual([
      "nested-after",
      "nested-after",
      "nested-after",
      "nested-after",
    ])
    const executionPaths = events(h)
      .filter((event) => event.kind === "terminal_text_sent" && event.stepId === "nested_before")
      .map((event) => event.data.executionPath)
    expect(executionPaths).toEqual([
      [
        { kind: "for", stepId: "outer_count", iterationIndex: 0 },
        { kind: "for", stepId: "inner_count", iterationIndex: 0 },
      ],
      [
        { kind: "for", stepId: "outer_count", iterationIndex: 0 },
        { kind: "for", stepId: "inner_count", iterationIndex: 1 },
      ],
      [
        { kind: "for", stepId: "outer_count", iterationIndex: 1 },
        { kind: "for", stepId: "inner_count", iterationIndex: 0 },
      ],
      [
        { kind: "for", stepId: "outer_count", iterationIndex: 1 },
        { kind: "for", stepId: "inner_count", iterationIndex: 1 },
      ],
    ])
  } finally {
    h.cleanup()
  }
})

test("user pause waits for a deferred notification boundary before publishing run_paused", async () => {
  const deliveryStarted = deferred<void>()
  const delivery = deferred<TelegramNotificationResult>()
  const dispatcher: NotificationDispatcher = {
    async sendTelegram() {
      deliveryStarted.resolve(undefined)
      return await delivery.promise
    },
  }
  const h = harness(dispatcher)
  try {
    h.templateStore.save("local", template("pause_notification_boundary", [
      {
        id: "notify_once",
        type: "notify",
        level: "info",
        title: "Boundary",
        message: { parts: [{ kind: "text", text: "deferred" }] },
        channels: [{ kind: "telegram", profileId: "profile-a" }],
        onFailure: "pause",
      },
      { id: "after_notify", type: "send", terminal: worker, message: { parts: [{ kind: "text", text: "after-notify" }] }, enter: false },
    ]), h.manager.indexMap("local"))

    await h.service.start("local", { templateId: "pause_notification_boundary" })
    await deliveryStarted.promise

    let pauseSettled = false
    const pausePromise = h.service.pause("local").then((snapshot) => {
      pauseSettled = true
      return snapshot
    })
    await Bun.sleep(40)

    expect(pauseSettled).toBe(false)
    expect(events(h).some((event) => event.kind === "run_paused")).toBe(false)

    delivery.resolve({ ok: true, profileId: "profile-a", status: 200 })
    const paused = await pausePromise
    expect(paused.status).toBe("paused")
    expect(sentContents(h, "after_notify")).toEqual([])

    const runEvents = events(h)
    const deliveredIndex = runEvents.findIndex((event) => event.kind === "notification_delivered" && event.stepId === "notify_once")
    const completedIndex = runEvents.findIndex((event) => event.kind === "step_completed" && event.stepId === "notify_once")
    const pausedIndex = runEvents.findIndex((event) => event.kind === "run_paused")
    expect(deliveredIndex).toBeGreaterThan(-1)
    expect(completedIndex).toBeGreaterThan(deliveredIndex)
    expect(pausedIndex).toBeGreaterThan(completedIndex)

    const pausedEvent = runEvents[pausedIndex]
    expect(pausedEvent?.stepId).toBe("notify_once")
    expect(pausedEvent?.data.executionPath).toEqual([])
    expect(pausedEvent?.data.nextStepId).toBe("after_notify")
    expect(pausedEvent?.data.nextExecutionPath).toEqual([])

    await h.service.resume("local")
    await waitFor(() => h.service.snapshot("local").status === "completed")
    expect(sentContents(h, "after_notify")).toEqual(["after-notify"])
  } finally {
    h.cleanup()
  }
})

test("finish control completed at a safe boundary wins over a concurrent pause request", async () => {
  const h = harness()
  try {
    h.templateStore.save("local", template("finish_pause_boundary", [
      {
        id: "finish_now",
        type: "finish",
        reason: "done",
        body: [
          { id: "finish_side_effect", type: "send", terminal: worker, message: { parts: [{ kind: "text", text: "finish-side-effect" }] }, enter: false },
        ],
      },
      { id: "must_not_run", type: "send", terminal: worker, message: { parts: [{ kind: "text", text: "must-not-run" }] }, enter: false },
    ]), h.manager.indexMap("local"))

    const gate = gateNextTerminalTextSentEvent(h, "finish_side_effect")
    await h.service.start("local", { templateId: "finish_pause_boundary" })
    await gate.started

    let pauseSettled = false
    const pausePromise = h.service.pause("local").then((snapshot) => {
      pauseSettled = true
      return snapshot
    })
    await Bun.sleep(30)
    expect(pauseSettled).toBe(false)

    gate.release()
    const settled = await pausePromise
    expect(settled.status).toBe("completed")
    expect(sentContents(h, "finish_side_effect")).toEqual(["finish-side-effect"])
    expect(sentContents(h, "must_not_run")).toEqual([])
    expect(events(h).filter((event) => event.kind === "run_completed")).toHaveLength(1)
    expect(events(h).filter((event) => event.kind === "run_paused")).toHaveLength(0)
  } finally {
    h.cleanup()
  }
})

test("stop requested during the last side effect wins after that action reaches its boundary", async () => {
  const h = harness()
  try {
    h.templateStore.save("local", template("stop_last_action_boundary", [
      { id: "last_send", type: "send", terminal: worker, message: { parts: [{ kind: "text", text: "last-side-effect" }] }, enter: false },
    ]), h.manager.indexMap("local"))

    const gate = gateNextTerminalTextSentEvent(h, "last_send")
    await h.service.start("local", { templateId: "stop_last_action_boundary" })
    await gate.started

    let stopSettled = false
    const stopPromise = h.service.stop("local").then((snapshot) => {
      stopSettled = true
      return snapshot
    })
    await Bun.sleep(30)
    expect(stopSettled).toBe(false)

    gate.release()
    const stopped = await stopPromise
    expect(stopped.status).toBe("stopped")
    expect(sentContents(h, "last_send")).toEqual(["last-side-effect"])

    const runEvents = events(h)
    const sentIndex = runEvents.findIndex((event) => event.kind === "terminal_text_sent" && event.stepId === "last_send")
    const completedIndex = runEvents.findIndex((event) => event.kind === "step_completed" && event.stepId === "last_send")
    const stoppedIndex = runEvents.findIndex((event) => event.kind === "run_stopped")
    expect(completedIndex).toBeGreaterThan(sentIndex)
    expect(stoppedIndex).toBeGreaterThan(completedIndex)
    expect(runEvents.filter((event) => event.kind === "run_completed")).toHaveLength(0)
  } finally {
    h.cleanup()
  }
})

test("concurrent submitInput claims one occurrence and sends only once", async () => {
  const h = harness()
  try {
    h.templateStore.save("local", template("concurrent_input_claim", [
      { id: "input_once", type: "input", terminal: worker, prompt: "Input once", allowEmpty: false, enter: false },
    ]), h.manager.indexMap("local"))

    await h.service.start("local", { templateId: "concurrent_input_claim" })
    await waitFor(() => h.service.snapshot("local").status === "waiting_user_input")

    const settled = await Promise.allSettled([
      h.service.submitInput("local", "first"),
      h.service.submitInput("local", "second"),
    ])
    await waitFor(() => h.service.snapshot("local").status === "completed")

    expect(settled.filter((result) => result.status === "fulfilled")).toHaveLength(1)
    const rejected = settled.find((result): result is PromiseRejectedResult => result.status === "rejected")
    expect(rejected?.reason).toBeInstanceOf(Error)
    expect((rejected?.reason as Error).message).toBe("input_submission_in_progress")
    expect(sentContents(h, "input_once")).toEqual(["first"])
    expect(events(h).filter((event) => event.kind === "user_input_submitted" && event.stepId === "input_once")).toHaveLength(1)
    expect(events(h).filter((event) => event.kind === "terminal_text_sent" && event.stepId === "input_once")).toHaveLength(1)
  } finally {
    h.cleanup()
  }
})

test("pause racing with submitInput settles after one send and does not resume the run", async () => {
  const h = harness()
  try {
    h.templateStore.save("local", template("pause_input_race", [
      { id: "input_race", type: "input", terminal: worker, prompt: "Race", allowEmpty: false, enter: false },
      { id: "after_input_race", type: "send", terminal: worker, message: { parts: [{ kind: "text", text: "after-race" }] }, enter: false },
    ]), h.manager.indexMap("local"))

    await h.service.start("local", { templateId: "pause_input_race" })
    await waitFor(() => h.service.snapshot("local").status === "waiting_user_input")
    const gate = gateNextUserInputArtifact(h)
    const submitPromise = h.service.submitInput("local", "claimed")
    await gate.started

    let pauseSettled = false
    const pausePromise = h.service.pause("local").then((snapshot) => {
      pauseSettled = true
      return snapshot
    })
    await Bun.sleep(30)
    expect(pauseSettled).toBe(false)

    gate.release()
    const [submitted, paused] = await Promise.all([submitPromise, pausePromise])
    expect(submitted.status).toBe("paused")
    expect(paused.status).toBe("paused")
    expect(sentContents(h, "input_race")).toEqual(["claimed"])
    expect(sentContents(h, "after_input_race")).toEqual([])

    const runEvents = events(h)
    const sentIndex = runEvents.findIndex((event) => event.kind === "terminal_text_sent" && event.stepId === "input_race")
    const completedIndex = runEvents.findIndex((event) => event.kind === "step_completed" && event.stepId === "input_race")
    const pausedIndex = runEvents.findIndex((event) => event.kind === "run_paused")
    expect(completedIndex).toBeGreaterThan(sentIndex)
    expect(pausedIndex).toBeGreaterThan(completedIndex)

    const pausedEvent = runEvents[pausedIndex]
    expect(pausedEvent?.stepId).toBe("input_race")
    expect(pausedEvent?.data.executionPath).toEqual([])
    expect(pausedEvent?.data.nextStepId).toBe("after_input_race")
    expect(pausedEvent?.data.nextExecutionPath).toEqual([])

    await h.service.resume("local")
    await waitFor(() => h.service.snapshot("local").status === "completed")
    expect(sentContents(h, "input_race")).toEqual(["claimed"])
    expect(sentContents(h, "after_input_race")).toEqual(["after-race"])
  } finally {
    h.cleanup()
  }
})

test("stop racing with submitInput remains stopped after the claimed send finishes", async () => {
  const h = harness()
  try {
    h.templateStore.save("local", template("stop_input_race", [
      { id: "input_stop_race", type: "input", terminal: worker, prompt: "Race", allowEmpty: false, enter: false },
      { id: "must_not_run", type: "send", terminal: worker, message: { parts: [{ kind: "text", text: "must-not-run" }] }, enter: false },
    ]), h.manager.indexMap("local"))

    await h.service.start("local", { templateId: "stop_input_race" })
    await waitFor(() => h.service.snapshot("local").status === "waiting_user_input")
    const gate = gateNextUserInputArtifact(h)
    const submitPromise = h.service.submitInput("local", "claimed-before-stop")
    await gate.started

    let stopSettled = false
    const stopPromise = h.service.stop("local").then((snapshot) => {
      stopSettled = true
      return snapshot
    })
    await Bun.sleep(30)
    expect(stopSettled).toBe(false)

    gate.release()
    const [submitted, stopped] = await Promise.all([submitPromise, stopPromise])
    expect(submitted.status).toBe("stopped")
    expect(stopped.status).toBe("stopped")
    expect(h.service.snapshot("local").status).toBe("stopped")
    expect(sentContents(h, "input_stop_race")).toEqual(["claimed-before-stop"])
    expect(sentContents(h, "must_not_run")).toEqual([])
    expect(events(h).filter((event) => event.kind === "run_stopped")).toHaveLength(1)
    expect(events(h).filter((event) => event.kind === "run_completed")).toHaveLength(0)
  } finally {
    h.cleanup()
  }
})

test("forever loop user-continue resume advances dynamic occurrences without replay", async () => {
  const h = harness()
  try {
    h.templateStore.save("local", template("forever_resume_cursor", [
      {
        id: "forever_loop",
        type: "for",
        range: { kind: "forever" },
        body: [
          { id: "forever_send", type: "send", terminal: worker, message: { parts: [{ kind: "text", text: "forever-once" }] }, enter: false },
          { id: "forever_continue", type: "wait", mode: "user-continue", prompt: "Continue forever loop" },
        ],
      },
    ]), h.manager.indexMap("local"))

    await h.service.start("local", { templateId: "forever_resume_cursor" })
    for (let expected = 1; expected <= 3; expected += 1) {
      await waitFor(() => h.service.snapshot("local").status === "waiting")
      expect(sentContents(h, "forever_send")).toHaveLength(expected)
      if (expected < 3) await h.service.resume("local")
    }

    expect(events(h)
      .filter((event) => event.kind === "terminal_text_sent" && event.stepId === "forever_send")
      .map((event) => event.data.executionPath)).toEqual([
      [{ kind: "for", stepId: "forever_loop", iterationIndex: 0 }],
      [{ kind: "for", stepId: "forever_loop", iterationIndex: 1 }],
      [{ kind: "for", stepId: "forever_loop", iterationIndex: 2 }],
    ])
    const stopped = await h.service.stop("local")
    expect(stopped.status).toBe("stopped")
  } finally {
    h.cleanup()
  }
})

test("parallel lanes inside text-list resume only unfinished occurrences", async () => {
  const h = harness()
  try {
    h.templateStore.save("local", template("loop_parallel_resume_cursor", [
      {
        id: "outer_text_loop",
        type: "for",
        range: { kind: "text-list", items: ["X"] },
        body: [
          {
            id: "parallel_in_loop",
            type: "parallel",
            lanes: [
              {
                id: "worker_lane",
                label: "Worker",
                terminal: worker,
                body: [
                  { id: "worker_lane_send", type: "send", terminal: worker, message: { parts: [{ kind: "template", template: "worker={{text}}" }] }, enter: false },
                  { id: "worker_lane_wait", type: "wait", mode: "duration", durationMs: 250 },
                  { id: "worker_lane_output", type: "output", source: { kind: "none" } },
                ],
              },
              {
                id: "reviewer_lane",
                label: "Reviewer",
                terminal: reviewer,
                body: [
                  { id: "reviewer_lane_send", type: "send", terminal: reviewer, message: { parts: [{ kind: "template", template: "reviewer={{text}}" }] }, enter: false },
                  { id: "reviewer_lane_wait", type: "wait", mode: "duration", durationMs: 250 },
                  { id: "reviewer_lane_output", type: "output", source: { kind: "none" } },
                ],
              },
            ],
            merge: { kind: "sectioned_text", separator: "===== {laneId} =====", includeEmptyOutputs: true },
            onLaneFail: "fail",
          },
          { id: "after_parallel", type: "send", terminal: worker, message: { parts: [{ kind: "template", template: "after={{text}}" }] }, enter: false },
        ],
      },
    ]), h.manager.indexMap("local"))

    await h.service.start("local", { templateId: "loop_parallel_resume_cursor" })
    await waitFor(() => events(h).filter((event) => event.kind === "wait_started" && (event.stepId === "worker_lane_wait" || event.stepId === "reviewer_lane_wait")).length === 2)
    const paused = await h.service.pause("local")
    expect(paused.status).toBe("paused")
    expect(sentContents(h, "worker_lane_send")).toEqual(["worker=X"])
    expect(sentContents(h, "reviewer_lane_send")).toEqual(["reviewer=X"])

    await h.service.resume("local")
    await waitFor(() => h.service.snapshot("local").status === "completed", 3000)
    expect(sentContents(h, "worker_lane_send")).toEqual(["worker=X"])
    expect(sentContents(h, "reviewer_lane_send")).toEqual(["reviewer=X"])
    expect(sentContents(h, "after_parallel")).toEqual(["after=X"])
    expect(events(h).filter((event) => event.kind === "parallel_lane_completed" && event.stepId === "parallel_in_loop")).toHaveLength(2)
  } finally {
    h.cleanup()
  }
})

test("control-terminal action body inherits the enclosing text binding", async () => {
  const h = harness()
  try {
    h.templateStore.save("local", template("control_body_binding", [
      {
        id: "control_binding_loop",
        type: "for",
        range: { kind: "text-list", items: ["control-item"] },
        body: [
          {
            id: "finish_with_body",
            type: "finish",
            reason: "done",
            body: [
              { id: "control_body_send", type: "send", terminal: worker, message: { parts: [{ kind: "template", template: "control={{text}}" }] }, enter: false },
            ],
          },
        ],
      },
    ]), h.manager.indexMap("local"))

    await h.service.start("local", { templateId: "control_body_binding" })
    await waitFor(() => h.service.snapshot("local").status === "completed")
    expect(sentContents(h, "control_body_send")).toEqual(["control=control-item"])
    expect(events(h).find((event) => event.kind === "terminal_text_sent" && event.stepId === "control_body_send")?.data.executionPath).toEqual([
      { kind: "for", stepId: "control_binding_loop", iterationIndex: 0 },
    ])
  } finally {
    h.cleanup()
  }
})

test("loop descendants inherit an outer artifact occurrence", async () => {
  const h = harness()
  try {
    h.manager.setTextContent("local", collector, "outer-artifact")
    h.templateStore.save("local", template("outer_artifact_inheritance", [
      { id: "capture_outer", type: "capture-source", capture: { kind: "text-box", terminal: collector } },
      {
        id: "artifact_loop",
        type: "for",
        range: { kind: "text-list", items: ["A", "B"] },
        body: [
          {
            id: "send_outer_artifact",
            type: "send",
            terminal: worker,
            message: {
              parts: [
                { kind: "template", template: "{{text}}:" },
                { kind: "artifact", source: { kind: "step_artifact", stepId: "capture_outer", artifact: "captured_text" } },
              ],
            },
            enter: false,
          },
        ],
      },
    ]), h.manager.indexMap("local"))

    await h.service.start("local", { templateId: "outer_artifact_inheritance" })
    await waitFor(() => h.service.snapshot("local").status === "completed")
    expect(sentContents(h, "send_outer_artifact")).toEqual(["A:outer-artifact", "B:outer-artifact"])
  } finally {
    h.cleanup()
  }
})

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function gateNextTerminalTextSentEvent(h: Harness, stepId: string) {
  const started = deferred<void>()
  const release = deferred<void>()
  const originalAppendEvent = h.runStore.appendEvent.bind(h.runStore)
  let held = false
  h.runStore.appendEvent = async (...args: Parameters<RunEventStore["appendEvent"]>) => {
    const input = args[2]
    if (!held && input.kind === "terminal_text_sent" && input.stepId === stepId) {
      held = true
      started.resolve(undefined)
      await release.promise
    }
    return await originalAppendEvent(...args)
  }
  return {
    started: started.promise,
    release: () => release.resolve(undefined),
  }
}

function gateNextUserInputArtifact(h: Harness) {
  const started = deferred<void>()
  const release = deferred<void>()
  const originalWriteArtifact = h.runStore.writeArtifact.bind(h.runStore)
  let held = false
  h.runStore.writeArtifact = async (...args: Parameters<RunEventStore["writeArtifact"]>) => {
    if (!held && args[2] === "user-input") {
      held = true
      started.resolve(undefined)
      await release.promise
    }
    return await originalWriteArtifact(...args)
  }
  return {
    started: started.promise,
    release: () => release.resolve(undefined),
  }
}

function agentPrompt(options: { terminalId: string; text: string; turnId: string; receivedAt: string }): AgentEvent {
  return {
    protocolVersion: 1,
    agentKind: "codex",
    eventKind: "agent.prompt_submitted",
    configId: "local",
    terminalId: options.terminalId,
    launchId: "launch-resume-test",
    agentSessionId: "codex-session-resume-test",
    agentTurnId: options.turnId,
    adapterMetadata: { adapter: "codex-user-prompt-submit-hook", codexSessionId: "codex-session-resume-test" },
    capturedText: options.text,
    raw: { source: "codex.UserPromptSubmit", payload: { hook_event_name: "UserPromptSubmit" } },
    receivedAt: options.receivedAt,
  }
}

function agentOutput(options: { terminalId: string; text: string; turnId: string; receivedAt: string }): AgentEvent {
  return {
    protocolVersion: 1,
    agentKind: "codex",
    eventKind: "agent.output",
    configId: "local",
    terminalId: options.terminalId,
    launchId: "launch-resume-test",
    agentSessionId: "codex-session-resume-test",
    agentTurnId: options.turnId,
    adapterMetadata: { adapter: "codex-stop-hook", codexSessionId: "codex-session-resume-test" },
    capturedText: options.text,
    raw: { source: "codex.Stop", payload: { hook_event_name: "Stop" } },
    receivedAt: options.receivedAt,
  }
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await Bun.sleep(20)
  }
  throw new Error("condition_timeout")
}
