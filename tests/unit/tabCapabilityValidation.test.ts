import { expect, test } from "bun:test"
import { validateFlowV2Template } from "../../src/lib/macro/flowV2Schema"
import type { TerminalIndexMapItem, TerminalSnapshot } from "../../src/lib/protocol"
import type { MacroTemplate } from "../../src/lib/macro/templateTypes"

const indexMap: TerminalIndexMapItem[] = [
  { index: 1, terminalId: "term_shell", terminalAlias: "shell_1" },
  { index: 2, terminalId: "term_text", terminalAlias: "text_1" },
]

const terminals: TerminalSnapshot[] = [
  snapshot("term_shell", "shell_1", 1, "fake"),
  snapshot("term_text", "text_1", 2, "text"),
]

function baseTemplate(body: MacroTemplate["body"]): MacroTemplate {
  const now = "2026-01-01T00:00:00.000Z"
  return {
    schemaVersion: 2,
    id: "tmpl_capability",
    name: "Capability",
    description: "",
    configId: "local",
    createdAt: now,
    updatedAt: now,
    body,
  }
}

function validate(template: MacroTemplate) {
  return validateFlowV2Template(template, { indexMap, terminals })
}

function issueText(template: MacroTemplate): string {
  return validate(template).issues.map((issue) => issue.path + ":" + issue.message).join("\n")
}

test("live validation rejects text tab for terminal quiet wait", () => {
  const result = validate(baseTemplate([
    { id: "wait_text", type: "wait", mode: "terminal-quiet", terminal: { kind: "alias", value: "text_1" }, quietMs: 10, maxMs: 100, onTimeout: "pause" },
  ]))
  expect(result.ok).toBe(false)
  expect(issueText(baseTemplate([
    { id: "wait_text", type: "wait", mode: "terminal-quiet", terminal: { kind: "alias", value: "text_1" }, quietMs: 10, maxMs: 100, onTimeout: "pause" },
  ]))).toContain("wait_text: target tab text_1 does not support terminal-quiet; required shell tab")
})

test("live validation rejects capture kinds incompatible with tab type", () => {
  const terminalBufferOnText = issueText(baseTemplate([
    { id: "capture_text_bad", type: "capture-source", capture: { kind: "terminal-buffer", terminal: { kind: "alias", value: "text_1" }, mode: "scrollback-tail", maxChars: 1000 } },
  ]))
  expect(terminalBufferOnText).toContain("capture_text_bad: target tab text_1 does not support terminal-buffer capture")

  const agentEventOnText = issueText(baseTemplate([
    { id: "capture_agent_bad", type: "capture-source", capture: { kind: "agent-event", terminal: { kind: "alias", value: "text_1" }, agent: { kind: "codex" }, captureMode: "result_only" } },
  ]))
  expect(agentEventOnText).toContain("capture_agent_bad: target tab text_1 does not support agent-event capture")

  const textBoxOnShell = issueText(baseTemplate([
    { id: "capture_shell_bad", type: "capture-source", capture: { kind: "text-box", terminal: { kind: "alias", value: "shell_1" } } },
  ]))
  expect(textBoxOnShell).toContain("capture_shell_bad: target tab shell_1 does not support text-box capture")
})

test("live validation applies tab capabilities inside parallel lanes", () => {
  const bad = issueText(baseTemplate([
    {
      id: "parallel_review",
      type: "parallel",
      lanes: [
        {
          id: "lane_text",
          label: "text",
          terminal: { kind: "alias", value: "text_1" },
          body: [
            { id: "lane_wait", type: "wait", mode: "duration", durationMs: 10 },
            { id: "lane_capture", type: "capture-source", capture: { kind: "terminal-buffer", terminal: { kind: "alias", value: "text_1" }, mode: "scrollback-tail", maxChars: 1000 } },
            { id: "lane_output", type: "output", source: { kind: "none" } },
          ],
        },
      ],
      merge: { kind: "sectioned_text", separator: "\n---\n", includeEmptyOutputs: false },
      onLaneFail: "pause",
    },
  ]))
  expect(bad).toContain("lane_wait: target tab text_1 does not support wait; required shell tab")
  expect(bad).toContain("lane_capture: target tab text_1 does not support terminal-buffer capture")

  const ok = validate(baseTemplate([
    {
      id: "parallel_review",
      type: "parallel",
      lanes: [
        {
          id: "lane_shell",
          label: "shell",
          terminal: { kind: "alias", value: "shell_1" },
          body: [
            { id: "lane_shell_capture", type: "capture-source", capture: { kind: "terminal-buffer", terminal: { kind: "alias", value: "shell_1" }, mode: "scrollback-tail", maxChars: 1000 } },
            { id: "lane_shell_output", type: "output", source: { kind: "step_artifact", stepId: "lane_shell_capture", artifact: "captured_text" } },
          ],
        },
        {
          id: "lane_text",
          label: "text",
          terminal: { kind: "alias", value: "text_1" },
          body: [
            { id: "lane_text_capture", type: "capture-source", capture: { kind: "text-box", terminal: { kind: "alias", value: "text_1" } } },
            { id: "lane_text_output", type: "output", source: { kind: "step_artifact", stepId: "lane_text_capture", artifact: "captured_text" } },
          ],
        },
      ],
      merge: { kind: "sectioned_text", separator: "\n---\n", includeEmptyOutputs: false },
      onLaneFail: "pause",
    },
  ]))
  expect(ok.ok).toBe(true)
})

test("offline structural validation stays capability agnostic without live terminals", () => {
  const template = baseTemplate([
    { id: "capture_offline", type: "capture-source", capture: { kind: "terminal-buffer", terminal: { kind: "alias", value: "text_1" }, mode: "scrollback-tail", maxChars: 1000 } },
  ])
  expect(validateFlowV2Template(template, { indexMap }).ok).toBe(true)
})

function snapshot(terminalId: string, terminalAlias: string, index: number, backend: TerminalSnapshot["backend"]): TerminalSnapshot {
  return {
    type: "terminal_snapshot",
    configId: "local",
    terminalId,
    launchId: "launch_" + terminalId,
    terminalAlias,
    terminalIndex: index,
    visualOrder: index,
    status: "running",
    cols: 80,
    rows: 24,
    backend,
    replay: [],
    exitCode: null,
    signal: null,
  }
}
