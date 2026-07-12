import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, test } from "bun:test"
import { AgentEventStore } from "../../src/lib/agentEvents/agentEventStore"
import { MacroTemplateStore } from "../../src/lib/macro/templateStore"
import type { MacroTemplate, ParallelNode } from "../../src/lib/macro/templateTypes"
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

function nestedArtifactRef(event: { data: Record<string, unknown> } | undefined, key: "content" | "write"): string {
  const value = event?.data[key]
  if (!value || typeof value !== "object" || !("artifactRef" in value)) return ""
  return String((value as { artifactRef: unknown }).artifactRef)
}

function parallelReviewNode(waitOnDocs = false): ParallelNode {
  const worker = { kind: "alias" as const, value: "worker" }
  const reviewer = { kind: "alias" as const, value: "reviewer" }
  const docsBody: ParallelNode["lanes"][number]["body"] = [
    { id: "send_docs", type: "send", terminal: worker, message: { parts: [{ kind: "text", text: waitOnDocs ? "docs timeout" : "docs ready" }] }, ending: "cr" },
    ...(waitOnDocs ? [{ id: "wait_docs", type: "wait" as const, mode: "terminal-quiet" as const, terminal: worker, quietMs: 50, maxMs: 100, onTimeout: "pause" as const }] : []),
    { id: "capture_docs", type: "capture-source", capture: { kind: "terminal-buffer", terminal: worker, mode: "scrollback-tail", maxChars: 12000 } },
    { id: "output_docs", type: "output", source: { kind: "step_artifact", stepId: "capture_docs", artifact: "captured_text" } },
  ]
  return {
    id: "parallel_review",
    type: "parallel",
    lanes: [
      { id: "docs", label: "Docs", terminal: worker, body: docsBody },
      { id: "tests", label: "Tests", terminal: reviewer, body: [
        { id: "send_tests", type: "send", terminal: reviewer, message: { parts: [{ kind: "text", text: "tests ready" }] }, ending: "cr" },
        { id: "capture_tests", type: "capture-source", capture: { kind: "terminal-buffer", terminal: reviewer, mode: "scrollback-tail", maxChars: 12000 } },
        { id: "output_tests", type: "output", source: { kind: "step_artifact", stepId: "capture_tests", artifact: "captured_text" } },
      ] },
    ],
    merge: { kind: "sectioned_text", separator: "===== {laneId} | {terminalAlias} =====", includeEmptyOutputs: true },
    onLaneFail: "pause",
  }
}

test("Flow V2 runner executes send, wait, capture, if.text_match and finish", async () => {
  const h = harness()
  try {
    h.templateStore.save("local", template("flow_happy", [
      { id: "send", type: "send", terminal: { kind: "alias", value: "worker" }, message: { parts: [{ kind: "text", text: "hello ready" }] }, ending: "cr" },
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
        { id: "send_before_finish", type: "send", terminal: { kind: "alias", value: "worker" }, message: { parts: [{ kind: "text", text: "before-return-action" }] }, ending: "cr" },
      ] },
    ]), h.manager.indexMap("local"))
    await h.service.start("local", { templateId: "finish_action_body" })
    await waitFor(() => h.service.snapshot("local").status === "completed")
    const events = h.service.snapshot("local").run?.replay.events ?? []
    expect(events.some((event) => event.kind === "terminal_text_sent" && event.stepId === "send_before_finish")).toBe(true)
    expect(events.some((event) => event.kind === "step_completed" && event.stepId === "finish_done")).toBe(true)
  } finally {
    h.cleanup()
  }
})

test("Flow V2 send concatenates ordered text and source parts without implicit separators", async () => {
  const h = harness()
  try {
    h.templateStore.save("local", template("send_parts_flow", [
      { id: "seed", type: "send", terminal: { kind: "alias", value: "worker" }, message: { parts: [{ kind: "text", text: "seed-context" }] }, ending: "cr" },
      { id: "capture", type: "capture-source", capture: { kind: "terminal-buffer", terminal: { kind: "alias", value: "worker" }, mode: "scrollback-tail", maxChars: 12000 } },
      { id: "send_composite", type: "send", terminal: { kind: "alias", value: "reviewer" }, message: { parts: [{ kind: "text", text: "prefix[" }, { kind: "artifact", source: { kind: "step_artifact", stepId: "capture", artifact: "captured_text" } }, { kind: "text", text: "]suffix" }] }, ending: "cr" },
      { id: "finish_done", type: "finish", reason: "done" },
    ]), h.manager.indexMap("local"))
    await h.service.start("local", { templateId: "send_parts_flow" })
    await waitFor(() => h.service.snapshot("local").status === "completed")
    const line = h.service.snapshot("local").run?.replay.events.find((event) => event.kind === "terminal_text_sent" && event.stepId === "send_composite")
    const sent = h.runStore.readArtifact("local", String(h.service.snapshot("local").runId), nestedArtifactRef(line, "content"))
    expect(sent.startsWith("prefix[")).toBe(true)
    expect(sent.startsWith("prefix[\n")).toBe(false)
    expect(sent).toContain("seed-context")
    expect(sent.endsWith("]suffix")).toBe(true)
  } finally {
    h.cleanup()
  }
})

test("Flow V2 send ending cr records content and CR write payload", async () => {
  const h = harness()
  try {
    h.templateStore.save("local", template("send_ending_cr", [
      { id: "send_submit", type: "send", terminal: { kind: "alias", value: "worker" }, message: { parts: [{ kind: "text", text: "submit me" }] }, ending: "cr" },
      { id: "finish_done", type: "finish", reason: "done" },
    ]), h.manager.indexMap("local"))
    await h.service.start("local", { templateId: "send_ending_cr" })
    await waitFor(() => h.service.snapshot("local").status === "completed")
    const event = h.service.snapshot("local").run?.replay.events.find((item) => item.kind === "terminal_text_sent" && item.stepId === "send_submit")
    expect(event?.data.ending).toBe("cr")
    const runId = String(h.service.snapshot("local").runId)
    expect(h.runStore.readArtifact("local", runId, nestedArtifactRef(event, "content"))).toBe("submit me")
    expect(h.runStore.readArtifact("local", runId, nestedArtifactRef(event, "write"))).toBe("submit me\r")
  } finally {
    h.cleanup()
  }
})

test("Flow V2 send ending none writes exact content without suffix", async () => {
  const h = harness()
  try {
    h.templateStore.save("local", template("send_ending_none", [
      { id: "send_raw", type: "send", terminal: { kind: "alias", value: "worker" }, message: { parts: [{ kind: "text", text: "raw text" }] }, ending: "none" },
      { id: "finish_done", type: "finish", reason: "done" },
    ]), h.manager.indexMap("local"))
    await h.service.start("local", { templateId: "send_ending_none" })
    await waitFor(() => h.service.snapshot("local").status === "completed")
    const event = h.service.snapshot("local").run?.replay.events.find((item) => item.kind === "terminal_text_sent" && item.stepId === "send_raw")
    expect(event?.data.ending).toBe("none")
    const runId = String(h.service.snapshot("local").runId)
    expect(h.runStore.readArtifact("local", runId, nestedArtifactRef(event, "content"))).toBe("raw text")
    expect(h.runStore.readArtifact("local", runId, nestedArtifactRef(event, "write"))).toBe("raw text")
  } finally {
    h.cleanup()
  }
})

test("terminal-buffer raw-stream-tail uses raw artifact as captured_text", async () => {
  const h = harness()
  try {
    h.templateStore.save("local", template("raw_capture_flow", [
      { id: "seed", type: "send", terminal: { kind: "alias", value: "worker" }, message: { parts: [{ kind: "text", text: "seed-raw" }] }, ending: "cr" },
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

test("Flow V2 send can append rendered text to a text box deck slot", async () => {
  const h = harness()
  try {
    h.templateStore.save("local", template("send_to_text_box", [
      { id: "send_collect", type: "send", terminal: { kind: "alias", value: "collector" }, message: { parts: [{ kind: "text", text: "collected result" }] }, ending: "cr" },
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
      { id: "seed", type: "send", terminal: { kind: "alias", value: "worker" }, message: { parts: [{ kind: "text", text: "alpha" }] }, ending: "cr" },
      { id: "capture", type: "capture-source", capture: { kind: "terminal-buffer", terminal: { kind: "alias", value: "worker" }, mode: "scrollback-tail", maxChars: 12000 } },
      { id: "extract_last", type: "extract_text", source: { kind: "step_artifact", stepId: "capture", artifact: "captured_text" }, split: { kind: "lines", keepEmpty: false }, filters: [{ kind: "exclude", matcher: { kind: "regex", pattern: "^\\s*[$#>]\\s*$" } }], select: { mode: "index", index: -1 }, extract: { kind: "regex", pattern: "^ECHO:(.*)$", group: 1 }, trim: "both", onEmpty: "pause" },
      { id: "send_extract", type: "send", terminal: { kind: "alias", value: "reviewer" }, message: { parts: [{ kind: "text", text: "got:" }, { kind: "artifact", source: { kind: "step_artifact", stepId: "extract_last", artifact: "extracted_text" } }] }, ending: "cr" },
      { id: "finish_done", type: "finish", reason: "done" },
    ]), h.manager.indexMap("local"))
    await h.service.start("local", { templateId: "extract_text_flow" })
    await waitFor(() => h.service.snapshot("local").status === "completed")
    const events = h.service.snapshot("local").run?.replay.events ?? []
    const extracted = events.find((event) => event.kind === "text_extracted" && event.stepId === "extract_last")
    expect(extracted?.data.outputChars).toBeGreaterThan(0)
    const sent = events.find((event) => event.kind === "terminal_text_sent" && event.stepId === "send_extract")
    const text = h.runStore.readArtifact("local", String(h.service.snapshot("local").runId), nestedArtifactRef(sent, "content"))
    expect(text).toContain("got:alpha")
  } finally {
    h.cleanup()
  }
})

test("Flow V2 input uses one defaultSource as editable runtime input", async () => {
  const h = harness()
  try {
    h.templateStore.save("local", template("input_flow", [
      { id: "seed", type: "send", terminal: { kind: "alias", value: "worker" }, message: { parts: [{ kind: "text", text: "default context" }] }, ending: "cr" },
      { id: "capture", type: "capture-source", capture: { kind: "terminal-buffer", terminal: { kind: "alias", value: "worker" }, mode: "scrollback-tail", maxChars: 12000 } },
      { id: "input", type: "input", terminal: { kind: "alias", value: "worker" }, prompt: "Direction", allowEmpty: false, defaultSource: { kind: "step_artifact", stepId: "capture", artifact: "captured_text" }, ending: "cr" },
      { id: "finish_done", type: "finish", reason: "done" },
    ]), h.manager.indexMap("local"))
    await h.service.start("local", { templateId: "input_flow" })
    await waitFor(() => h.service.snapshot("local").status === "waiting_user_input")
    expect(h.service.snapshot("local").waitingInput?.defaultText).toContain("default context")
    await h.service.submitInput("local", "fix it")
    await waitFor(() => h.service.snapshot("local").status === "completed")
    const line = h.service.snapshot("local").run?.replay.events.find((event) => event.kind === "terminal_text_sent" && event.stepId === "input")
    expect(nestedArtifactRef(line, "content")).toBeTruthy()
    const sent = h.runStore.readArtifact("local", String(h.service.snapshot("local").runId), nestedArtifactRef(line, "content"))
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
        { id: "send_should_skip", type: "send", terminal: { kind: "alias", value: "worker" }, message: { parts: [{ kind: "text", text: "should-not-run" }] }, ending: "cr" },
      ] },
      { id: "send_after_loop", type: "send", terminal: { kind: "alias", value: "worker" }, message: { parts: [{ kind: "text", text: "after-loop" }] }, ending: "cr" },
      { id: "finish_done", type: "finish", reason: "done" },
    ]), h.manager.indexMap("local"))
    await h.service.start("local", { templateId: "extract_continue_loop" })
    await waitFor(() => h.service.snapshot("local").status === "completed")
    const events = h.service.snapshot("local").run?.replay.events ?? []
    const transitions = events.filter((event) => event.kind === "control_transition" && event.stepId === "loop_count")
    expect(transitions).toHaveLength(2)
    expect(events.some((event) => event.kind === "terminal_text_sent" && event.stepId === "send_should_skip")).toBe(false)
    expect(events.some((event) => event.kind === "terminal_text_sent" && event.stepId === "send_after_loop")).toBe(true)
  } finally {
    h.cleanup()
  }
})

test("Flow V2 for forever loops until break", async () => {
  const h = harness()
  try {
    h.templateStore.save("local", template("forever_break", [
      { id: "loop_forever", type: "for", range: { kind: "forever" }, body: [
        { id: "send_loop", type: "send", terminal: { kind: "alias", value: "worker" }, message: { parts: [{ kind: "text", text: "FOREVER_BREAK_READY" }] }, ending: "cr" },
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

test("Flow V2 parallel merges lane outputs for downstream send", async () => {
  const h = harness()
  try {
    h.templateStore.save("local", template("parallel_flow", [
      parallelReviewNode(),
      { id: "send_merged", type: "send", terminal: { kind: "alias", value: "worker" }, message: { parts: [{ kind: "artifact", source: { kind: "step_artifact", stepId: "parallel_review", artifact: "merged_text" } }] }, ending: "cr" },
    ]), h.manager.indexMap("local"))
    await h.service.start("local", { templateId: "parallel_flow" })
    await waitFor(() => h.service.snapshot("local").status === "completed")
    const events = h.service.snapshot("local").run?.replay.events ?? []
    expect(events.map((event) => event.kind)).toContain("parallel_joined")
    const joinedIndex = events.findIndex((event) => event.kind === "parallel_joined" && event.stepId === "parallel_review")
    const parentCompletions = events.map((event, index) => ({ event, index })).filter((entry) => entry.event.kind === "step_completed" && entry.event.stepId === "parallel_review")
    expect(parentCompletions.length).toBe(1)
    expect(parentCompletions[0].index).toBeGreaterThan(joinedIndex)
    const merged = events.find((event) => event.kind === "parallel_joined")?.data.artifactRef
    expect(String(merged)).toContain("parallel-merged")
  } finally {
    h.cleanup()
  }
})

test("Flow V2 parallel pauses on lane wait timeout before capture and merge", async () => {
  const h = harness()
  try {
    h.templateStore.save("local", template("parallel_wait_timeout", [
      parallelReviewNode(true),
      { id: "send_merged", type: "send", terminal: { kind: "alias", value: "worker" }, message: { parts: [{ kind: "artifact", source: { kind: "step_artifact", stepId: "parallel_review", artifact: "merged_text" } }] }, ending: "cr" },
    ]), h.manager.indexMap("local"))
    await h.service.start("local", { templateId: "parallel_wait_timeout" })
    const noise = setInterval(() => h.manager.input("local", { kind: "alias", value: "worker" }, "tick"), 10)
    try {
      await waitFor(() => h.service.snapshot("local").status === "paused")
    } finally {
      clearInterval(noise)
    }
    const events = h.service.snapshot("local").run?.replay.events ?? []
    expect(events.some((event) => event.kind === "wait_timeout" && event.stepId === "wait_docs")).toBe(true)
    expect(events.some((event) => event.kind === "parallel_lane_completed" && event.data.laneId === "docs")).toBe(false)
    expect(events.some((event) => event.kind === "parallel_joined")).toBe(false)
    expect(events.some((event) => event.kind === "step_completed" && event.stepId === "parallel_review")).toBe(false)
  } finally {
    h.cleanup()
  }
})

test("Flow V2 parallel resume skips completed lane sends", async () => {
  const h = harness()
  try {
    h.templateStore.save("local", template("parallel_resume_skip", [
      parallelReviewNode(true),
      { id: "send_merged", type: "send", terminal: { kind: "alias", value: "worker" }, message: { parts: [{ kind: "artifact", source: { kind: "step_artifact", stepId: "parallel_review", artifact: "merged_text" } }] }, ending: "cr" },
    ]), h.manager.indexMap("local"))
    await h.service.start("local", { templateId: "parallel_resume_skip" })
    const noise = setInterval(() => h.manager.input("local", { kind: "alias", value: "worker" }, "tick"), 10)
    try {
      await waitFor(() => h.service.snapshot("local").status === "paused")
    } finally {
      clearInterval(noise)
    }

    const beforeResumeEvents = h.service.snapshot("local").run?.replay.events ?? []
    expect(beforeResumeEvents.filter((event) => event.kind === "terminal_text_sent" && (event.stepId === "send_docs" || event.stepId === "send_tests")).map((event) => event.stepId)).toEqual(["send_docs", "send_tests"])

    await h.service.resume("local")
    await waitFor(() => h.service.snapshot("local").status === "completed")
    const afterResumeEvents = h.service.snapshot("local").run?.replay.events ?? []
    expect(afterResumeEvents.filter((event) => event.kind === "step_started" && event.stepId === "parallel_review")).toHaveLength(1)
    expect(afterResumeEvents.filter((event) => event.kind === "parallel_started" && event.stepId === "parallel_review")).toHaveLength(1)
    expect(afterResumeEvents.filter((event) => event.kind === "terminal_text_sent" && event.stepId === "send_docs")).toHaveLength(1)
    expect(afterResumeEvents.filter((event) => event.kind === "terminal_text_sent" && event.stepId === "send_tests")).toHaveLength(1)
    expect(afterResumeEvents.filter((event) => event.kind === "parallel_lane_started" && event.data.laneId === "tests")).toHaveLength(1)
    expect(afterResumeEvents.filter((event) => event.kind === "parallel_lane_completed" && event.data.laneId === "tests")).toHaveLength(1)
    expect(afterResumeEvents.some((event) => event.kind === "parallel_joined")).toBe(true)
  } finally {
    h.cleanup()
  }
})

test("Flow V2 parallel onLaneFail fail fails the run without joining", async () => {
  const h = harness()
  const previousAgentTimeout = process.env.SHELL_DECK_AGENT_EVENT_CAPTURE_TIMEOUT_MS
  process.env.SHELL_DECK_AGENT_EVENT_CAPTURE_TIMEOUT_MS = "1"
  try {
    const worker = { kind: "alias" as const, value: "worker" }
    const reviewer = { kind: "alias" as const, value: "reviewer" }
    const parallel: ParallelNode = {
      id: "parallel_review",
      type: "parallel",
      lanes: [
        { id: "docs", label: "Docs", terminal: worker, body: [
          { id: "capture_docs_agent", type: "capture-source", capture: { kind: "agent-event", terminal: worker, agent: { kind: "codex" }, captureMode: "result_only" } },
          { id: "output_docs", type: "output", source: { kind: "step_artifact", stepId: "capture_docs_agent", artifact: "captured_text" } },
        ] },
        { id: "tests", label: "Tests", terminal: reviewer, body: [
          { id: "send_tests", type: "send", terminal: reviewer, message: { parts: [{ kind: "text", text: "tests ready" }] }, ending: "cr" },
          { id: "capture_tests", type: "capture-source", capture: { kind: "terminal-buffer", terminal: reviewer, mode: "scrollback-tail", maxChars: 12000 } },
          { id: "output_tests", type: "output", source: { kind: "step_artifact", stepId: "capture_tests", artifact: "captured_text" } },
        ] },
      ],
      merge: { kind: "sectioned_text", separator: "===== {laneId} | {terminalAlias} =====", includeEmptyOutputs: true },
      onLaneFail: "fail",
    }
    h.templateStore.save("local", template("parallel_lane_fail", [
      parallel,
      { id: "send_merged", type: "send", terminal: { kind: "alias", value: "worker" }, message: { parts: [{ kind: "artifact", source: { kind: "step_artifact", stepId: "parallel_review", artifact: "merged_text" } }] }, ending: "cr" },
    ]), h.manager.indexMap("local"))
    await h.service.start("local", { templateId: "parallel_lane_fail" })
    await waitFor(() => h.service.snapshot("local").status === "failed")
    const snapshot = h.service.snapshot("local")
    const events = snapshot.run?.replay.events ?? []
    expect(snapshot.status).toBe("failed")
    expect(events.some((event) => event.kind === "step_failed" && event.stepId === "parallel_review" && event.data.code === "parallel_lane_failed")).toBe(true)
    expect(events.some((event) => event.kind === "run_failed" && event.data.code === "parallel_lane_failed")).toBe(true)
    expect(events.some((event) => event.kind === "parallel_joined")).toBe(false)
  } finally {
    if (previousAgentTimeout === undefined) delete process.env.SHELL_DECK_AGENT_EVENT_CAPTURE_TIMEOUT_MS
    else process.env.SHELL_DECK_AGENT_EVENT_CAPTURE_TIMEOUT_MS = previousAgentTimeout
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
