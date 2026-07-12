import { expect, test } from "bun:test"
import type { TerminalIndexMapItem, TerminalSnapshot } from "../../src/lib/protocol"
import { tabCapabilitiesForBackend, tabInfoForTarget, terminalChoiceForTarget, type TerminalChoice } from "../../src/lib/macro/tabCapabilities"

const indexMap: TerminalIndexMapItem[] = [
  { index: 1, terminalId: "term_shell", terminalAlias: "shell_1" },
  { index: 2, terminalId: "term_text", terminalAlias: "text_1" },
]

const terminals: TerminalSnapshot[] = [
  snapshot("term_shell", "shell_1", 1, "fake"),
  snapshot("term_text", "text_1", 2, "text"),
]

const choices: TerminalChoice[] = terminals.map((terminal) => ({
  value: "id:" + terminal.terminalId,
  label: terminal.terminalAlias,
  title: terminal.terminalId,
  index: terminal.terminalIndex,
  terminalId: terminal.terminalId,
  terminalAlias: terminal.terminalAlias,
  capabilities: tabCapabilitiesForBackend(terminal.backend),
}))

test("maps shell and text tab capabilities", () => {
  expect(tabCapabilitiesForBackend("fake")).toEqual({
    kind: "shell",
    canSend: true,
    canInput: true,
    canWaitQuiet: true,
    captureKinds: ["terminal-buffer", "agent-event"],
  })
  expect(tabCapabilitiesForBackend("real").kind).toBe("shell")
  expect(tabCapabilitiesForBackend("text")).toEqual({
    kind: "text",
    canSend: true,
    canInput: true,
    canWaitQuiet: false,
    captureKinds: ["text-box"],
  })
  expect(() => tabCapabilitiesForBackend("canvas" as never)).toThrow("unsupported_terminal_backend_kind:canvas")
})

test("resolves targets to choices and live tab info", () => {
  expect(terminalChoiceForTarget({ kind: "index", value: 2 }, choices)?.terminalAlias).toBe("text_1")
  expect(terminalChoiceForTarget({ kind: "alias", value: "shell_1" }, choices)?.capabilities.kind).toBe("shell")
  const info = tabInfoForTarget({ kind: "alias", value: "text_1" }, indexMap, terminals)
  expect(info.terminal?.terminalId).toBe("term_text")
  expect(info.capabilities?.captureKinds).toEqual(["text-box"])
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
