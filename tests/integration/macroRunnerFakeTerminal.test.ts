import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, test } from "bun:test"
import { AgentEventStore } from "../../src/lib/agentEvents/agentEventStore"
import { MacroTemplateStore } from "../../src/lib/macro/templateStore"
import type { MacroTemplate } from "../../src/lib/macro/templateTypes"
import { RunEventStore } from "../../src/lib/runLog/runEventStore"
import { TerminalDeckManager } from "../../server/terminalDeckManager"
import { MacroRunnerService } from "../../server/macroRunnerService"

function harness() {
  const root = mkdtempSync(join(tmpdir(), "shell-deck-runner-v2-"))
  const manager = new TerminalDeckManager()
  manager.createTerminal("local", { backend: "fake", terminalAlias: "worker" })
  manager.createTerminal("local", { backend: "fake", terminalAlias: "reviewer" })
  manager.createTerminal("local", { backend: "text", terminalAlias: "collector" })
  const runStore = new RunEventStore(root)
  const templateStore = new MacroTemplateStore(root)
  const agentStore = new AgentEventStore(root)
  const service = new MacroRunnerService(manager, templateStore, runStore, agentStore)
  return { root, manager, runStore, templateStore, service, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

function template(id: string, body: MacroTemplate["body"]): MacroTemplate {
  const now = "2026-01-01T00:00:00.000Z"
  return { schemaVersion: 2, id, name: id, description: "", configId: "local", body, createdAt: now, updatedAt: now }
}

test("Flow V2 runner executes send_line, wait, capture, if.text_match and finish", async () => {
  const h = harness()
  try {
    h.templateStore.save("local", template("flow_happy", [
      { id: "send", type: "send_line", terminal: { kind: "alias", value: "worker" }, message: { parts: [{ kind: "text", text: "hello ready" }] } },
      { id: "wait", type: "wait", mode: "duration", durationMs: 1 },
      { id: "capture", type: "capture-source", capture: { kind: "terminal-buffer", terminal: { kind: "alias", value: "worker" }, mode: "scrollback-tail", maxChars: 12000 } },
      { id: "if_ready", type: "if", branches: [{ kind: "if", condition: { kind: "text_match", source: { kind: "step_artifact", stepId: "capture", artifact: "captured_text" }, matcher: { kind: "simple", op: "contains", text: "hello ready" }, scope: { kind: "whole" } }, body: [{ id: "finish_ok", type: "finish", reason: "ok" }] }] },
    ]), h.manager.indexMap("local"))
    await h.service.start("local", { templateId: "flow_happy" })
    await waitFor(() => h.service.snapshot("local").status === "completed")
    const snapshot = h.service.snapshot("local")
    expect(snapshot.status).toBe("completed")
    expect(snapshot.run?.replay.events.map((event) => event.kind)).toContain("branch_decision")
    expect(snapshot.run?.derivedState.artifactRefs.some((ref) => ref.includes("capture-normalized"))).toBe(true)
  } finally {
    h.cleanup()
  }
})

test("Flow V2 control terminal action body runs before finish", async () => {
  const h = harness()
  try {
    h.templateStore.save("local", template("finish_action_body", [
      { id: "finish_done", type: "finish", reason: "done", body: [
        { id: "send_before_finish", type: "send_line", terminal: { kind: "alias", value: "worker" }, message: { parts: [{ kind: "text", text: "before-return-action" }] } },
      ] },
    ]), h.manager.indexMap("local"))
    await h.service.start("local", { templateId: "finish_action_body" })
    await waitFor(() => h.service.snapshot("local").status === "completed")
    const events = h.service.snapshot("local").run?.replay.events ?? []
    expect(events.some((event) => event.kind === "terminal_line_sent" && event.stepId === "send_before_finish")).toBe(true)
    expect(events.some((event) => event.kind === "step_completed" && event.stepId === "finish_done")).toBe(true)
  } finally {
    h.cleanup()
  }
})

test("Flow V2 send_line concatenates ordered text and source parts without implicit separators", async () => {
  const h = harness()
  try {
    h.templateStore.save("local", template("send_parts_flow", [
      { id: "seed", type: "send_line", terminal: { kind: "alias", value: "worker" }, message: { parts: [{ kind: "text", text: "seed-context" }] } },
      { id: "capture", type: "capture-source", capture: { kind: "terminal-buffer", terminal: { kind: "alias", value: "worker" }, mode: "scrollback-tail", maxChars: 12000 } },
      { id: "send_composite", type: "send_line", terminal: { kind: "alias", value: "reviewer" }, message: { parts: [{ kind: "text", text: "prefix[" }, { kind: "artifact", source: { kind: "step_artifact", stepId: "capture", artifact: "captured_text" } }, { kind: "text", text: "]suffix" }] } },
      { id: "finish_done", type: "finish", reason: "done" },
    ]), h.manager.indexMap("local"))
    await h.service.start("local", { templateId: "send_parts_flow" })
    await waitFor(() => h.service.snapshot("local").status === "completed")
    const line = h.service.snapshot("local").run?.replay.events.find((event) => event.kind === "terminal_line_sent" && event.stepId === "send_composite")
    const sent = h.runStore.readArtifact("local", String(h.service.snapshot("local").runId), String(line?.data.artifactRef))
    expect(sent.startsWith("prefix[")).toBe(true)
    expect(sent.startsWith("prefix[\n")).toBe(false)
    expect(sent).toContain("seed-context")
    expect(sent.endsWith("]suffix")).toBe(true)
  } finally {
    h.cleanup()
  }
})

test("terminal-buffer raw-stream-tail uses raw artifact as captured_text", async () => {
  const h = harness()
  try {
    h.templateStore.save("local", template("raw_capture_flow", [
      { id: "seed", type: "send_line", terminal: { kind: "alias", value: "worker" }, message: { parts: [{ kind: "text", text: "seed-raw" }] } },
      { id: "capture", type: "capture-source", capture: { kind: "terminal-buffer", terminal: { kind: "alias", value: "worker" }, mode: "raw-stream-tail", maxChars: 12000 } },
      { id: "finish_done", type: "finish", reason: "done" },
    ]), h.manager.indexMap("local"))
    await h.service.start("local", { templateId: "raw_capture_flow" })
    await waitFor(() => h.service.snapshot("local").status === "completed")
    const captureEvent = h.service.snapshot("local").run?.replay.events.find((event) => event.kind === "capture_artifact_created" && event.stepId === "capture")
    expect(captureEvent?.data.mode).toBe("raw-stream-tail")
    expect(captureEvent?.data.artifactRef).toBe(captureEvent?.data.rawArtifactRef)
    expect(captureEvent?.data.artifactRef).not.toBe(captureEvent?.data.normalizedArtifactRef)
  } finally {
    h.cleanup()
  }
})

test("Flow V2 send_line can append rendered text to a text box deck slot", async () => {
  const h = harness()
  try {
    h.templateStore.save("local", template("send_to_text_box", [
      { id: "send_collect", type: "send_line", terminal: { kind: "alias", value: "collector" }, message: { parts: [{ kind: "text", text: "collected result" }] } },
      { id: "finish_done", type: "finish", reason: "done" },
    ]), h.manager.indexMap("local"))
    await h.service.start("local", { templateId: "send_to_text_box" })
    await waitFor(() => h.service.snapshot("local").status === "completed")
    const collector = h.manager.deckSnapshot("local").terminals.find((terminal) => terminal.terminalAlias === "collector")
    expect(collector?.backend).toBe("text")
    expect(collector?.replay.join("")).toContain("collected result\n")
  } finally {
    h.cleanup()
  }
})

test("Flow V2 capture-source can read a text box deck slot", async () => {
  const h = harness()
  try {
    h.manager.setTextContent("local", { kind: "alias", value: "collector" }, "draft notes\nREADY from text box")
    h.templateStore.save("local", template("capture_text_box", [
      { id: "capture_notes", type: "capture-source", capture: { kind: "text-box", terminal: { kind: "alias", value: "collector" } } },
      { id: "if_ready", type: "if", branches: [{ kind: "if", condition: { kind: "text_match", source: { kind: "step_artifact", stepId: "capture_notes", artifact: "captured_text" }, matcher: { kind: "simple", op: "contains", text: "READY from text box" }, scope: { kind: "whole" } }, body: [{ id: "finish_ok", type: "finish", reason: "ok" }] }] },
    ]), h.manager.indexMap("local"))
    await h.service.start("local", { templateId: "capture_text_box" })
    await waitFor(() => h.service.snapshot("local").status === "completed")
    const captureEvent = h.service.snapshot("local").run?.replay.events.find((event) => event.kind === "capture_artifact_created" && event.stepId === "capture_notes")
    expect(captureEvent?.data.captureKind).toBe("text-box")
    const captured = h.runStore.readArtifact("local", String(h.service.snapshot("local").runId), String(captureEvent?.data.artifactRef))
    expect(captured).toBe("draft notes\nREADY from text box")
  } finally {
    h.cleanup()
  }
})

test("Flow V2 extract_text filters and selects captured text for downstream send", async () => {
  const h = harness()
  try {
    h.templateStore.save("local", template("extract_text_flow", [
      { id: "seed", type: "send_line", terminal: { kind: "alias", value: "worker" }, message: { parts: [{ kind: "text", text: "alpha" }] } },
      { id: "capture", type: "capture-source", capture: { kind: "terminal-buffer", terminal: { kind: "alias", value: "worker" }, mode: "scrollback-tail", maxChars: 12000 } },
      { id: "extract_last", type: "extract_text", source: { kind: "step_artifact", stepId: "capture", artifact: "captured_text" }, split: { kind: "lines", keepEmpty: false }, filters: [{ kind: "exclude", matcher: { kind: "regex", pattern: "^\\s*[$#>]\\s*$" } }], select: { mode: "index", index: -1 }, extract: { kind: "regex", pattern: "^ECHO:(.*)$", group: 1 }, trim: "both", onEmpty: "pause" },
      { id: "send_extract", type: "send_line", terminal: { kind: "alias", value: "reviewer" }, message: { parts: [{ kind: "text", text: "got:" }, { kind: "artifact", source: { kind: "step_artifact", stepId: "extract_last", artifact: "extracted_text" } }] } },
      { id: "finish_done", type: "finish", reason: "done" },
    ]), h.manager.indexMap("local"))
    await h.service.start("local", { templateId: "extract_text_flow" })
    await waitFor(() => h.service.snapshot("local").status === "completed")
    const events = h.service.snapshot("local").run?.replay.events ?? []
    const extracted = events.find((event) => event.kind === "text_extracted" && event.stepId === "extract_last")
    expect(extracted?.data.outputChars).toBeGreaterThan(0)
    const sent = events.find((event) => event.kind === "terminal_line_sent" && event.stepId === "send_extract")
    const text = h.runStore.readArtifact("local", String(h.service.snapshot("local").runId), String(sent?.data.artifactRef))
    expect(text).toContain("got:alpha")
  } finally {
    h.cleanup()
  }
})

test("Flow V2 input_line uses one defaultSource as editable runtime input", async () => {
  const h = harness()
  try {
    h.templateStore.save("local", template("input_flow", [
      { id: "seed", type: "send_line", terminal: { kind: "alias", value: "worker" }, message: { parts: [{ kind: "text", text: "default context" }] } },
      { id: "capture", type: "capture-source", capture: { kind: "terminal-buffer", terminal: { kind: "alias", value: "worker" }, mode: "scrollback-tail", maxChars: 12000 } },
      { id: "input", type: "input_line", terminal: { kind: "alias", value: "worker" }, prompt: "Direction", allowEmpty: false, defaultSource: { kind: "step_artifact", stepId: "capture", artifact: "captured_text" } },
      { id: "finish_done", type: "finish", reason: "done" },
    ]), h.manager.indexMap("local"))
    await h.service.start("local", { templateId: "input_flow" })
    await waitFor(() => h.service.snapshot("local").status === "waiting_user_input")
    expect(h.service.snapshot("local").waitingInput?.defaultText).toContain("default context")
    await h.service.submitInput("local", "fix it")
    await waitFor(() => h.service.snapshot("local").status === "completed")
    const line = h.service.snapshot("local").run?.replay.events.find((event) => event.kind === "terminal_line_sent" && event.stepId === "input")
    expect(line?.data.artifactRef).toBeTruthy()
    const sent = h.runStore.readArtifact("local", String(h.service.snapshot("local").runId), String(line?.data.artifactRef))
    expect(sent).toBe("fix it")
  } finally {
    h.cleanup()
  }
})

test("Flow V2 extract_text onEmpty continue skips to next loop iteration", async () => {
  const h = harness()
  try {
    h.manager.setTextContent("local", { kind: "alias", value: "collector" }, "")
    h.templateStore.save("local", template("extract_continue_loop", [
      { id: "capture_empty", type: "capture-source", capture: { kind: "text-box", terminal: { kind: "alias", value: "collector" } } },
      { id: "loop_count", type: "for", range: { kind: "count", count: 2 }, body: [
        { id: "extract_empty", type: "extract_text", source: { kind: "step_artifact", stepId: "capture_empty", artifact: "captured_text" }, split: { kind: "lines", keepEmpty: false }, filters: [], select: { mode: "index", index: -1 }, extract: { kind: "none" }, trim: "both", onEmpty: "continue" },
        { id: "send_should_skip", type: "send_line", terminal: { kind: "alias", value: "worker" }, message: { parts: [{ kind: "text", text: "should-not-run" }] } },
      ] },
      { id: "send_after_loop", type: "send_line", terminal: { kind: "alias", value: "worker" }, message: { parts: [{ kind: "text", text: "after-loop" }] } },
      { id: "finish_done", type: "finish", reason: "done" },
    ]), h.manager.indexMap("local"))
    await h.service.start("local", { templateId: "extract_continue_loop" })
    await waitFor(() => h.service.snapshot("local").status === "completed")
    const events = h.service.snapshot("local").run?.replay.events ?? []
    const transitions = events.filter((event) => event.kind === "control_transition" && event.stepId === "loop_count")
    expect(transitions).toHaveLength(2)
    expect(events.some((event) => event.kind === "terminal_line_sent" && event.stepId === "send_should_skip")).toBe(false)
    expect(events.some((event) => event.kind === "terminal_line_sent" && event.stepId === "send_after_loop")).toBe(true)
  } finally {
    h.cleanup()
  }
})

test("Flow V2 for forever loops until break", async () => {
  const h = harness()
  try {
    h.templateStore.save("local", template("forever_break", [
      { id: "loop_forever", type: "for", range: { kind: "forever" }, body: [
        { id: "send_loop", type: "send_line", terminal: { kind: "alias", value: "worker" }, message: { parts: [{ kind: "text", text: "FOREVER_BREAK_READY" }] } },
        { id: "capture_loop", type: "capture-source", capture: { kind: "terminal-buffer", terminal: { kind: "alias", value: "worker" }, mode: "scrollback-tail", maxChars: 12000 } },
        { id: "if_break", type: "if", branches: [{ kind: "if", condition: { kind: "text_match", source: { kind: "step_artifact", stepId: "capture_loop", artifact: "captured_text" }, matcher: { kind: "simple", op: "contains", text: "FOREVER_BREAK_READY" }, scope: { kind: "whole" } }, body: [{ id: "break_loop", type: "break", reason: "matched" }] }] },
      ] },
      { id: "finish_done", type: "finish", reason: "done" },
    ]), h.manager.indexMap("local"))
    await h.service.start("local", { templateId: "forever_break" })
    await waitFor(() => h.service.snapshot("local").status === "completed")
    const transitions = h.service.snapshot("local").run?.replay.events.filter((event) => event.kind === "control_transition" && event.stepId === "loop_forever") ?? []
    expect(transitions).toHaveLength(1)
    expect(transitions[0]?.data.forever).toBe(true)
  } finally {
    h.cleanup()
  }
})

test("Flow V2 parallel_send_capture merges item captures for downstream send", async () => {
  const h = harness()
  try {
    h.templateStore.save("local", template("parallel_flow", [
      {
        id: "parallel_review",
        type: "parallel_send_capture",
        items: [
          { id: "docs", terminal: { kind: "alias", value: "worker" }, send: { id: "send_docs", type: "send_line", terminal: { kind: "alias", value: "worker" }, message: { parts: [{ kind: "text", text: "docs ready" }] } }, capture: { id: "capture_docs", type: "capture-source", capture: { kind: "terminal-buffer", terminal: { kind: "alias", value: "worker" }, mode: "scrollback-tail", maxChars: 12000 } } },
          { id: "tests", terminal: { kind: "alias", value: "reviewer" }, send: { id: "send_tests", type: "send_line", terminal: { kind: "alias", value: "reviewer" }, message: { parts: [{ kind: "text", text: "tests ready" }] } }, capture: { id: "capture_tests", type: "capture-source", capture: { kind: "terminal-buffer", terminal: { kind: "alias", value: "reviewer" }, mode: "scrollback-tail", maxChars: 12000 } } },
        ],
        merge: { kind: "sectioned_text", separator: "===== {itemId} | {terminalAlias} =====", order: "item_order", includeEmptyCaptures: true },
        onItemFail: "pause",
      },
      { id: "send_merged", type: "send_line", terminal: { kind: "alias", value: "worker" }, message: { parts: [{ kind: "artifact", source: { kind: "step_artifact", stepId: "parallel_review", artifact: "merged_text" } }] } },
    ]), h.manager.indexMap("local"))
    await h.service.start("local", { templateId: "parallel_flow" })
    await waitFor(() => h.service.snapshot("local").status === "completed")
    const events = h.service.snapshot("local").run?.replay.events ?? []
    expect(events.map((event) => event.kind)).toContain("parallel_send_capture_joined")
    const joinedIndex = events.findIndex((event) => event.kind === "parallel_send_capture_joined" && event.stepId === "parallel_review")
    const parentCompletions = events.map((event, index) => ({ event, index })).filter((entry) => entry.event.kind === "step_completed" && entry.event.stepId === "parallel_review")
    expect(parentCompletions.length).toBe(1)
    expect(parentCompletions[0].index).toBeGreaterThan(joinedIndex)
    const merged = events.find((event) => event.kind === "parallel_send_capture_joined")?.data.artifactRef
    expect(String(merged)).toContain("parallel-merged")
  } finally {
    h.cleanup()
  }
})

test("Flow V2 parallel_send_capture pauses on item wait timeout before capture and merge", async () => {
  const h = harness()
  try {
    h.templateStore.save("local", template("parallel_wait_timeout", [
      {
        id: "parallel_review",
        type: "parallel_send_capture",
        items: [
          { id: "docs", terminal: { kind: "alias", value: "worker" }, send: { id: "send_docs", type: "send_line", terminal: { kind: "alias", value: "worker" }, message: { parts: [{ kind: "text", text: "docs timeout" }] } }, wait: { id: "wait_docs", type: "wait", mode: "terminal-quiet", terminal: { kind: "alias", value: "worker" }, quietMs: 50, maxMs: 100, onTimeout: "pause" }, capture: { id: "capture_docs", type: "capture-source", capture: { kind: "terminal-buffer", terminal: { kind: "alias", value: "worker" }, mode: "scrollback-tail", maxChars: 12000 } } },
          { id: "tests", terminal: { kind: "alias", value: "reviewer" }, send: { id: "send_tests", type: "send_line", terminal: { kind: "alias", value: "reviewer" }, message: { parts: [{ kind: "text", text: "tests ready" }] } }, capture: { id: "capture_tests", type: "capture-source", capture: { kind: "terminal-buffer", terminal: { kind: "alias", value: "reviewer" }, mode: "scrollback-tail", maxChars: 12000 } } },
        ],
        merge: { kind: "sectioned_text", separator: "===== {itemId} | {terminalAlias} =====", order: "item_order", includeEmptyCaptures: true },
        onItemFail: "pause",
      },
      { id: "send_merged", type: "send_line", terminal: { kind: "alias", value: "worker" }, message: { parts: [{ kind: "artifact", source: { kind: "step_artifact", stepId: "parallel_review", artifact: "merged_text" } }] } },
    ]), h.manager.indexMap("local"))
    await h.service.start("local", { templateId: "parallel_wait_timeout" })
    const noise = setInterval(() => h.manager.input("local", { kind: "alias", value: "worker" }, "tick"), 10)
    try {
      await waitFor(() => h.service.snapshot("local").status === "paused")
    } finally {
      clearInterval(noise)
    }
    const events = h.service.snapshot("local").run?.replay.events ?? []
    expect(events.some((event) => event.kind === "wait_timeout" && event.stepId === "parallel_review" && event.data.itemId === "docs")).toBe(true)
    expect(events.some((event) => event.kind === "parallel_send_capture_item_completed" && event.data.itemId === "docs")).toBe(false)
    expect(events.some((event) => event.kind === "parallel_send_capture_joined")).toBe(false)
    expect(events.some((event) => event.kind === "step_completed" && event.stepId === "parallel_review")).toBe(false)
  } finally {
    h.cleanup()
  }
})

async function waitFor(predicate: () => boolean, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await Bun.sleep(20)
  }
  throw new Error("condition_timeout")
}
