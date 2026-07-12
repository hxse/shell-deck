import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, test } from "bun:test"
import { MacroRunnerService } from "../../server/macroRunnerService"
import type { TerminalBackend, TerminalBackendEvent } from "../../server/terminalBackend"
import { TerminalDeckManager } from "../../server/terminalDeckManager"
import { AgentEventStore } from "../../src/lib/agentEvents/agentEventStore"
import { MacroTemplateStore } from "../../src/lib/macro/templateStore"
import type { MacroTemplate, TerminalEnding, TerminalInputDelivery } from "../../src/lib/macro/templateTypes"
import { RunEventStore } from "../../src/lib/runLog/runEventStore"

class RecordingBackend implements TerminalBackend {
  readonly kind = "fake" as const
  readonly inputChannel = "helper-stdin-pipe" as const

  constructor(readonly writes: string[]) {}
  #events: TerminalBackendEvent | null = null

  start(events: TerminalBackendEvent): void {
    this.#events = events
  }

  write(data: string): void {
    this.writes.push(data)
    this.#events?.onData(data)
  }

  resize(_cols: number, _rows: number): void {}

  close(): void {}
}

function harness() {
  const root = mkdtempSync(join(tmpdir(), "shell-deck-ending-runner-"))
  const writes = new Map<string, string[]>()
  const manager = new TerminalDeckManager({
    backendFactory: (_kind, options) => {
      const terminalWrites: string[] = []
      writes.set(String(options.terminalId), terminalWrites)
      return new RecordingBackend(terminalWrites)
    },
  })
  manager.createTerminal("local", { backend: "fake", terminalId: "term_worker", terminalAlias: "worker" })
  manager.createTerminal("local", { backend: "fake", terminalId: "term_reviewer", terminalAlias: "reviewer" })
  manager.createTerminal("local", { backend: "text", terminalId: "term_collector", terminalAlias: "collector" })
  const runStore = new RunEventStore(root)
  const templateStore = new MacroTemplateStore(root)
  const service = new MacroRunnerService(manager, templateStore, runStore, new AgentEventStore(root))
  return { root, writes, manager, runStore, templateStore, service, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

function template(id: string, body: MacroTemplate["body"]): MacroTemplate {
  const now = "2026-07-12T00:00:00.000Z"
  return { schemaVersion: 2, id, name: id, description: "", configId: "local", body, createdAt: now, updatedAt: now }
}

test("send writes exact direct and bracketed-paste payloads across all terminal endings", async () => {
  const h = harness()
  try {
    const cases: Array<{ ending: TerminalEnding; sequence: string }> = [
      { ending: "none", sequence: "" },
      { ending: "lf", sequence: "\n" },
      { ending: "cr", sequence: "\r" },
      { ending: "crlf", sequence: "\r\n" },
    ]
    const deliveries: Array<{ delivery: TerminalInputDelivery; prefix: string; postfix: string }> = [
      { delivery: "direct", prefix: "", postfix: "" },
      { delivery: "bracketed-paste", prefix: "\u001b[200~", postfix: "\u001b[201~" },
    ]

    for (const delivery of deliveries) {
      for (const item of cases) {
        const templateId = "delivery_" + delivery.delivery + "_" + item.ending
        h.templateStore.save("local", template(templateId, [
          { id: "send_" + item.ending, type: "send", terminal: { kind: "alias", value: "worker" }, message: { parts: [{ kind: "text", text: "payload" }] }, delivery: delivery.delivery, ending: item.ending },
        ]), h.manager.indexMap("local"))
        const writesBefore = h.writes.get("term_worker")?.length ?? 0
        await h.service.start("local", { templateId })
        await waitFor(() => h.service.snapshot("local").status === "completed")

        const snapshot = h.service.snapshot("local")
        const event = snapshot.run?.replay.events.find((candidate) => candidate.kind === "terminal_text_sent")
        const content = h.runStore.readArtifact("local", String(snapshot.runId), artifactRef(event, "content"))
        const write = h.runStore.readArtifact("local", String(snapshot.runId), artifactRef(event, "write"))
        const expected = delivery.prefix + "payload" + delivery.postfix + item.sequence
        expect(content).toBe("payload")
        expect(write).toBe(expected)
        expect(Array.from(Buffer.from(write))).toEqual(Array.from(Buffer.from(expected)))
        expect(h.writes.get("term_worker")?.at(-1)).toBe(write)
        expect(event?.data.delivery).toBe(delivery.delivery)
        expect(event?.data.resolvedDelivery).toBe(delivery.delivery)
        expect(h.writes.get("term_worker")).toHaveLength(writesBefore + 1)
        expect(event?.data.ending).toBe(item.ending)
        expect(event?.data.enter).toBeUndefined()
        expect(event?.data.enterSequence).toBeUndefined()
        expect((event?.data.write as { chars?: unknown } | undefined)?.chars).toBe(write.length)
      }
    }
  } finally {
    h.cleanup()
  }
})

test("target-aware Auto and manual overrides record all requested/resolved delivery pairs", async () => {
  const h = harness()
  try {
    const cases = [
      { id: "auto_shell", terminal: "worker", terminalId: "term_worker", delivery: "auto", resolved: "bracketed-paste", expected: "\u001b[200~auto_shell\u001b[201~\r" },
      { id: "auto_text", terminal: "collector", terminalId: "term_collector", delivery: "auto", resolved: "direct", expected: "auto_text\r" },
      { id: "direct_shell", terminal: "worker", terminalId: "term_worker", delivery: "direct", resolved: "direct", expected: "direct_shell\r" },
      { id: "bracketed_text", terminal: "collector", terminalId: "term_collector", delivery: "bracketed-paste", resolved: "bracketed-paste", expected: "\u001b[200~bracketed_text\u001b[201~\r" },
    ] as const

    for (const item of cases) {
      h.templateStore.save("local", template(item.id, [{
        id: "send_" + item.id,
        type: "send",
        terminal: { kind: "alias", value: item.terminal },
        message: { parts: [{ kind: "text", text: item.id }] },
        delivery: item.delivery,
        ending: "cr",
      }]), h.manager.indexMap("local"))
      await h.service.start("local", { templateId: item.id })
      await waitFor(() => h.service.snapshot("local").status === "completed")

      const snapshot = h.service.snapshot("local")
      const event = snapshot.run?.replay.events.find((candidate) => candidate.kind === "terminal_text_sent")
      const write = h.runStore.readArtifact("local", String(snapshot.runId), artifactRef(event, "write"))
      expect([event?.data.delivery, event?.data.resolvedDelivery, event?.data.ending]).toEqual([item.delivery, item.resolved, "cr"])
      expect(write).toBe(item.expected)
      expect(h.writes.get(item.terminalId)?.at(-1)).toBe(item.expected)
    }
  } finally {
    h.cleanup()
  }
})

test("runtime input resolves Auto from the current target snapshot at submission time", async () => {
  const h = harness()
  try {
    h.templateStore.save("local", template("auto_input_target_reset", [{
      id: "auto_input_after_reset",
      type: "input",
      terminal: { kind: "alias", value: "worker" },
      prompt: "Input",
      allowEmpty: false,
      delivery: "auto",
      ending: "cr",
    }]), h.manager.indexMap("local"))

    await h.service.start("local", { templateId: "auto_input_target_reset" })
    await waitFor(() => h.service.snapshot("local").status === "waiting_user_input")
    expect(h.manager.deckSnapshot("local").terminals.find((terminal) => terminal.terminalId === "term_worker")?.backend).toBe("fake")
    expect(h.manager.resetTerminal("local", { kind: "id", value: "term_worker" }, "text")).toEqual({ ok: true })
    expect(h.manager.deckSnapshot("local").terminals.find((terminal) => terminal.terminalId === "term_worker")?.backend).toBe("text")

    await h.service.submitInput("local", "late-input")
    await waitFor(() => h.service.snapshot("local").status === "completed")

    const snapshot = h.service.snapshot("local")
    const sent = snapshot.run?.replay.events.find((event) => event.kind === "terminal_text_sent")
    expect(h.writes.get("term_worker")).toEqual(["late-input\r"])
    expect([sent?.data.delivery, sent?.data.resolvedDelivery, sent?.data.ending]).toEqual(["auto", "direct", "cr"])
    expect(h.runStore.readArtifact("local", String(snapshot.runId), artifactRef(sent, "write"))).toBe("late-input\r")
  } finally {
    h.cleanup()
  }
})

test("Auto Text send and input use direct bytes without bracketed-paste marker leakage", async () => {
  const root = mkdtempSync(join(tmpdir(), "shell-deck-auto-text-runner-"))
  const manager = new TerminalDeckManager()
  manager.createTerminal("local", { backend: "text", terminalId: "term_text_auto", terminalAlias: "collector" })
  const runStore = new RunEventStore(root)
  const templateStore = new MacroTemplateStore(root)
  const service = new MacroRunnerService(manager, templateStore, runStore, new AgentEventStore(root))
  try {
    templateStore.save("local", template("auto_text_panel", [
      {
        id: "auto_text_send",
        type: "send",
        terminal: { kind: "alias", value: "collector" },
        message: { parts: [{ kind: "text", text: "panel-send" }] },
        delivery: "auto",
        ending: "cr",
      },
      {
        id: "auto_text_input",
        type: "input",
        terminal: { kind: "alias", value: "collector" },
        prompt: "Panel input",
        allowEmpty: false,
        delivery: "auto",
        ending: "cr",
      },
    ]), manager.indexMap("local"))

    await service.start("local", { templateId: "auto_text_panel" })
    await waitFor(() => service.snapshot("local").status === "waiting_user_input")
    await service.submitInput("local", "panel-input")
    await waitFor(() => service.snapshot("local").status === "completed")

    const snapshot = service.snapshot("local")
    const replay = manager.deckSnapshot("local").terminals.find((terminal) => terminal.terminalId === "term_text_auto")?.replay.join("")
    expect(replay).toBe("panel-send\npanel-input\n")
    expect(replay).not.toContain("\u001b[200~")
    expect(replay).not.toContain("\u001b[201~")
    const sent = snapshot.run?.replay.events.filter((event) => event.kind === "terminal_text_sent") ?? []
    expect(sent.map((event) => [event.stepId, event.data.delivery, event.data.resolvedDelivery, event.data.ending])).toEqual([
      ["auto_text_send", "auto", "direct", "cr"],
      ["auto_text_input", "auto", "direct", "cr"],
    ])
    expect(sent.map((event) => runStore.readArtifact("local", String(snapshot.runId), artifactRef(event, "write")))).toEqual([
      "panel-send\r",
      "panel-input\r",
    ])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("Auto collision checks the resolved mode: Shell rejects and Text direct permits the marker", async () => {
  const h = harness()
  const markerContent = "head\u001b[201~tail"
  try {
    h.templateStore.save("local", template("auto_text_marker", [{
      id: "auto_text_marker_send",
      type: "send",
      terminal: { kind: "alias", value: "collector" },
      message: { parts: [{ kind: "text", text: markerContent }] },
      delivery: "auto",
      ending: "none",
    }]), h.manager.indexMap("local"))
    await h.service.start("local", { templateId: "auto_text_marker" })
    await waitFor(() => h.service.snapshot("local").status === "completed")
    let snapshot = h.service.snapshot("local")
    let sent = snapshot.run?.replay.events.find((event) => event.kind === "terminal_text_sent")
    expect(h.writes.get("term_collector")).toEqual([markerContent])
    expect([sent?.data.delivery, sent?.data.resolvedDelivery]).toEqual(["auto", "direct"])
    expect(h.runStore.readArtifact("local", String(snapshot.runId), artifactRef(sent, "write"))).toBe(markerContent)

    h.templateStore.save("local", template("auto_shell_marker", [{
      id: "auto_shell_marker_send",
      type: "send",
      terminal: { kind: "alias", value: "worker" },
      message: { parts: [{ kind: "text", text: markerContent }] },
      delivery: "auto",
      ending: "none",
    }]), h.manager.indexMap("local"))
    await h.service.start("local", { templateId: "auto_shell_marker" })
    await waitFor(() => h.service.snapshot("local").status === "paused")
    snapshot = h.service.snapshot("local")
    sent = snapshot.run?.replay.events.find((event) => event.kind === "terminal_text_sent")
    expect(snapshot.pauseReason?.message).toBe("terminal_input_rejected:bracketed_paste_end_marker_in_content")
    expect(h.writes.get("term_worker")).toEqual([])
    expect(sent).toBeUndefined()
    expect(h.runStore.artifacts.listRefs("local", String(snapshot.runId))).toEqual([])
  } finally {
    h.cleanup()
  }
})

test("input and parallel send reuse the bracketed-paste payload mapping", async () => {
  const h = harness()
  try {
    h.templateStore.save("local", template("input_parallel_endings", [
      { id: "input_lf", type: "input", terminal: { kind: "alias", value: "worker" }, prompt: "Input", allowEmpty: false, delivery: "bracketed-paste", ending: "lf" },
      {
        id: "parallel_endings",
        type: "parallel",
        lanes: [{
          id: "reviewer_lane",
          label: "Reviewer",
          terminal: { kind: "alias", value: "reviewer" },
          body: [
            { id: "parallel_send_crlf", type: "send", terminal: { kind: "alias", value: "reviewer" }, message: { parts: [{ kind: "text", text: "lane" }] }, delivery: "bracketed-paste", ending: "crlf" },
            { id: "parallel_output", type: "output", source: { kind: "none" } },
          ],
        }],
        merge: { kind: "sectioned_text", separator: "===== {laneId} =====", includeEmptyOutputs: false },
        onLaneFail: "fail",
      },
    ]), h.manager.indexMap("local"))

    await h.service.start("local", { templateId: "input_parallel_endings" })
    await waitFor(() => h.service.snapshot("local").status === "waiting_user_input")
    await h.service.submitInput("local", "answer")
    await waitFor(() => h.service.snapshot("local").status === "completed")

    expect(h.writes.get("term_worker")).toEqual(["\u001b[200~answer\u001b[201~\n"])
    expect(h.writes.get("term_reviewer")).toEqual(["\u001b[200~lane\u001b[201~\r\n"])
    const sent = h.service.snapshot("local").run?.replay.events.filter((event) => event.kind === "terminal_text_sent") ?? []
    expect(sent.map((event) => [event.stepId, event.data.delivery, event.data.resolvedDelivery, event.data.ending])).toEqual([
      ["input_lf", "bracketed-paste", "bracketed-paste", "lf"],
      ["parallel_send_crlf", "bracketed-paste", "bracketed-paste", "crlf"],
    ])
  } finally {
    h.cleanup()
  }
})

test("direct permits the end marker while bracketed cross-part collision pauses and repeats zero-write on resume", async () => {
  const h = harness()
  const content = "head\u001b[201~tail"
  try {
    h.templateStore.save("local", template("direct_marker", [
      {
        id: "direct_marker_send",
        type: "send",
        terminal: { kind: "alias", value: "worker" },
        message: { parts: [{ kind: "text", text: "head\u001b[20" }, { kind: "text", text: "1~tail" }] },
        delivery: "direct",
        ending: "none",
      },
    ]), h.manager.indexMap("local"))
    await h.service.start("local", { templateId: "direct_marker" })
    await waitFor(() => h.service.snapshot("local").status === "completed")
    expect(h.writes.get("term_worker")).toEqual([content])

    h.templateStore.save("local", template("bracketed_parts_collision", [
      {
        id: "collision_send",
        type: "send",
        terminal: { kind: "alias", value: "worker" },
        message: { parts: [{ kind: "text", text: "head\u001b[20" }, { kind: "text", text: "1~tail" }] },
        delivery: "bracketed-paste",
        ending: "cr",
      },
    ]), h.manager.indexMap("local"))
    await h.service.start("local", { templateId: "bracketed_parts_collision" })
    await waitFor(() => h.service.snapshot("local").status === "paused")

    let snapshot = h.service.snapshot("local")
    expect(snapshot.pauseReason?.message).toBe("terminal_input_rejected:bracketed_paste_end_marker_in_content")
    expect(h.writes.get("term_worker")).toEqual([content])
    expect(snapshot.run?.replay.events.some((event) => event.kind === "terminal_text_sent")).toBe(false)
    expect(snapshot.run?.replay.events.some((event) => event.kind === "step_completed" && event.stepId === "collision_send")).toBe(false)
    expect(h.runStore.artifacts.listRefs("local", String(snapshot.runId))).toEqual([])

    const pausesBeforeResume = snapshot.run?.replay.events.filter((event) => event.kind === "run_paused").length ?? 0
    await h.service.resume("local")
    await waitFor(() => h.service.snapshot("local").status === "paused")
    snapshot = h.service.snapshot("local")
    expect(snapshot.pauseReason?.message).toBe("terminal_input_rejected:bracketed_paste_end_marker_in_content")
    expect(h.writes.get("term_worker")).toEqual([content])
    expect(snapshot.run?.replay.events.some((event) => event.kind === "terminal_text_sent")).toBe(false)
    expect(h.runStore.artifacts.listRefs("local", String(snapshot.runId))).toEqual([])
    expect(snapshot.run?.replay.events.filter((event) => event.kind === "run_paused")).toHaveLength(pausesBeforeResume + 1)
  } finally {
    h.cleanup()
  }
})

test("bracketed collision checks fully rendered loop template content", async () => {
  const h = harness()
  try {
    h.templateStore.save("local", template("template_marker_collision", [{
      id: "marker_loop",
      type: "for",
      range: { kind: "text-list", items: [{ key: "marker", value: "\u001b[201~" }] },
      body: [{
        id: "template_collision_send",
        type: "send",
        terminal: { kind: "alias", value: "worker" },
        message: { parts: [{ kind: "text", text: "before" }, { kind: "template", template: "{{value}}" }, { kind: "text", text: "after" }] },
        delivery: "bracketed-paste",
        ending: "none",
      }],
    }]), h.manager.indexMap("local"))

    await h.service.start("local", { templateId: "template_marker_collision" })
    await waitFor(() => h.service.snapshot("local").status === "paused")
    const snapshot = h.service.snapshot("local")
    expect(snapshot.pauseReason?.message).toBe("terminal_input_rejected:bracketed_paste_end_marker_in_content")
    expect(h.writes.get("term_worker")).toEqual([])
    expect(snapshot.run?.replay.events.some((event) => event.kind === "terminal_text_sent")).toBe(false)
    expect(snapshot.run?.replay.events.some((event) => event.kind === "step_completed" && event.stepId === "template_collision_send")).toBe(false)
    expect(h.runStore.artifacts.listRefs("local", String(snapshot.runId))).toEqual([])
  } finally {
    h.cleanup()
  }
})

test("bracketed collision checks resolved artifact content before terminal artifacts", async () => {
  const h = harness()
  const marker = "\u001b[201~"
  try {
    h.templateStore.save("local", template("artifact_marker_collision", [
      {
        id: "seed_marker",
        type: "send",
        terminal: { kind: "alias", value: "worker" },
        message: { parts: [{ kind: "text", text: marker }] },
        delivery: "direct",
        ending: "none",
      },
      {
        id: "capture_marker",
        type: "capture-source",
        capture: { kind: "terminal-buffer", terminal: { kind: "alias", value: "worker" }, mode: "raw-stream-tail", maxChars: 12000 },
      },
      {
        id: "artifact_collision_send",
        type: "send",
        terminal: { kind: "alias", value: "reviewer" },
        message: { parts: [{ kind: "artifact", source: { kind: "step_artifact", stepId: "capture_marker", artifact: "captured_text" } }] },
        delivery: "bracketed-paste",
        ending: "cr",
      },
    ]), h.manager.indexMap("local"))

    await h.service.start("local", { templateId: "artifact_marker_collision" })
    await waitFor(() => h.service.snapshot("local").status === "paused")
    const snapshot = h.service.snapshot("local")
    const refs = h.runStore.artifacts.listRefs("local", String(snapshot.runId))
    expect(snapshot.pauseReason?.message).toBe("terminal_input_rejected:bracketed_paste_end_marker_in_content")
    expect(h.writes.get("term_worker")).toEqual([marker])
    expect(h.writes.get("term_reviewer")).toEqual([])
    expect(snapshot.run?.replay.events.filter((event) => event.kind === "terminal_text_sent").map((event) => event.stepId)).toEqual(["seed_marker"])
    expect(snapshot.run?.replay.events.some((event) => event.kind === "step_completed" && event.stepId === "artifact_collision_send")).toBe(false)
    expect(refs.filter((ref) => ref.includes("send-content-"))).toHaveLength(1)
    expect(refs.some((ref) => ref.includes("send-write-"))).toBe(false)
  } finally {
    h.cleanup()
  }
})

test("runtime input collision preserves input lifecycle, pauses, and waits for fresh input after resume", async () => {
  const h = harness()
  const marker = "\u001b[201~"
  try {
    h.templateStore.save("local", template("input_marker_collision", [{
      id: "collision_input",
      type: "input",
      terminal: { kind: "alias", value: "worker" },
      prompt: "Input",
      allowEmpty: false,
      delivery: "bracketed-paste",
      ending: "none",
    }]), h.manager.indexMap("local"))

    await h.service.start("local", { templateId: "input_marker_collision" })
    await waitFor(() => h.service.snapshot("local").status === "waiting_user_input")
    await h.service.submitInput("local", marker)
    await waitFor(() => h.service.snapshot("local").status === "paused")

    let snapshot = h.service.snapshot("local")
    let refs = h.runStore.artifacts.listRefs("local", String(snapshot.runId))
    expect(snapshot.pauseReason).toMatchObject({ code: "terminal_input_rejected", message: "bracketed_paste_end_marker_in_content", stepId: "collision_input" })
    expect(h.writes.get("term_worker")).toEqual([])
    expect(snapshot.run?.replay.events.some((event) => event.kind === "user_input_submitted")).toBe(true)
    expect(snapshot.run?.replay.events.some((event) => event.kind === "terminal_text_sent")).toBe(false)
    expect(snapshot.run?.replay.events.some((event) => event.kind === "step_completed" && event.stepId === "collision_input")).toBe(false)
    expect(refs.filter((ref) => ref.includes("user-input-"))).toHaveLength(1)
    expect(refs.some((ref) => ref.includes("input-content-") || ref.includes("input-write-"))).toBe(false)

    await h.service.resume("local")
    await waitFor(() => h.service.snapshot("local").status === "waiting_user_input")
    expect(h.writes.get("term_worker")).toEqual([])
    await h.service.submitInput("local", "safe")
    await waitFor(() => h.service.snapshot("local").status === "completed")

    snapshot = h.service.snapshot("local")
    refs = h.runStore.artifacts.listRefs("local", String(snapshot.runId))
    expect(h.writes.get("term_worker")).toEqual(["\u001b[200~safe\u001b[201~"])
    expect(snapshot.run?.replay.events.filter((event) => event.kind === "user_input_submitted")).toHaveLength(2)
    expect(snapshot.run?.replay.events.filter((event) => event.kind === "terminal_text_sent")).toHaveLength(1)
    expect(refs.filter((ref) => ref.includes("user-input-"))).toHaveLength(2)
  } finally {
    h.cleanup()
  }
})

test("parallel send collision follows onLaneFail policy without terminal evidence", async () => {
  for (const policy of ["fail", "pause"] as const) {
    const h = harness()
    try {
      h.templateStore.save("local", template("parallel_marker_" + policy, [{
        id: "parallel_marker",
        type: "parallel",
        lanes: [{
          id: "marker_lane",
          label: "Marker",
          terminal: { kind: "alias", value: "reviewer" },
          body: [
            {
              id: "parallel_collision_send",
              type: "send",
              terminal: { kind: "alias", value: "reviewer" },
              message: { parts: [{ kind: "text", text: "\u001b[201~" }] },
              delivery: "bracketed-paste",
              ending: "cr",
            },
            { id: "parallel_output", type: "output", source: { kind: "none" } },
          ],
        }],
        merge: { kind: "sectioned_text", separator: "===== {laneId} =====", includeEmptyOutputs: false },
        onLaneFail: policy,
      }]), h.manager.indexMap("local"))

      await h.service.start("local", { templateId: "parallel_marker_" + policy })
      await waitFor(() => h.service.snapshot("local").status === (policy === "fail" ? "failed" : "paused"))
      let snapshot = h.service.snapshot("local")
      expect(snapshot.pauseReason?.message).toBe("terminal_input_rejected:bracketed_paste_end_marker_in_content")
      expect(h.writes.get("term_reviewer")).toEqual([])
      expect(snapshot.run?.replay.events.some((event) => event.kind === "terminal_text_sent")).toBe(false)
      expect(snapshot.run?.replay.events.some((event) => event.kind === "step_completed" && event.stepId === "parallel_collision_send")).toBe(false)
      expect(h.runStore.artifacts.listRefs("local", String(snapshot.runId))).toEqual([])

      if (policy === "pause") {
        const pausesBeforeResume = snapshot.run?.replay.events.filter((event) => event.kind === "run_paused").length ?? 0
        await h.service.resume("local")
        await waitFor(() => h.service.snapshot("local").status === "paused")
        snapshot = h.service.snapshot("local")
        expect(snapshot.pauseReason?.message).toBe("terminal_input_rejected:bracketed_paste_end_marker_in_content")
        expect(h.writes.get("term_reviewer")).toEqual([])
        expect(snapshot.run?.replay.events.some((event) => event.kind === "terminal_text_sent")).toBe(false)
        expect(snapshot.run?.replay.events.filter((event) => event.kind === "run_paused")).toHaveLength(pausesBeforeResume + 1)
      }
    } finally {
      h.cleanup()
    }
  }
})

function artifactRef(event: { data: Record<string, unknown> } | undefined, key: "content" | "write"): string {
  const value = event?.data[key]
  if (!value || typeof value !== "object" || !("artifactRef" in value)) return ""
  return String((value as { artifactRef: unknown }).artifactRef)
}

async function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const startedAt = Date.now()
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error("timeout")
    await Bun.sleep(10)
  }
}
