import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, test } from "bun:test"
import { MacroRunnerService } from "../../server/macroRunnerService"
import type { TerminalBackend, TerminalBackendEvent } from "../../server/terminalBackend"
import { TerminalDeckManager } from "../../server/terminalDeckManager"
import { AgentEventStore } from "../../src/lib/agentEvents/agentEventStore"
import { MacroTemplateStore } from "../../src/lib/macro/templateStore"
import type { MacroTemplate, TerminalEnding } from "../../src/lib/macro/templateTypes"
import { RunEventStore } from "../../src/lib/runLog/runEventStore"

class RecordingBackend implements TerminalBackend {
  readonly kind = "fake" as const
  readonly inputChannel = "helper-stdin-pipe" as const

  constructor(readonly writes: string[]) {}

  start(_events: TerminalBackendEvent): void {}

  write(data: string): void {
    this.writes.push(data)
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
  const runStore = new RunEventStore(root)
  const templateStore = new MacroTemplateStore(root)
  const service = new MacroRunnerService(manager, templateStore, runStore, new AgentEventStore(root))
  return { root, writes, manager, runStore, templateStore, service, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

function template(id: string, body: MacroTemplate["body"]): MacroTemplate {
  const now = "2026-07-12T00:00:00.000Z"
  return { schemaVersion: 2, id, name: id, description: "", configId: "local", body, createdAt: now, updatedAt: now }
}

test("send writes exact none, LF, CR and CRLF terminal ending bytes", async () => {
  const h = harness()
  try {
    const cases: Array<{ ending: TerminalEnding; sequence: string; bytes: number[] }> = [
      { ending: "none", sequence: "", bytes: [] },
      { ending: "lf", sequence: "\n", bytes: [0x0a] },
      { ending: "cr", sequence: "\r", bytes: [0x0d] },
      { ending: "crlf", sequence: "\r\n", bytes: [0x0d, 0x0a] },
    ]

    for (const item of cases) {
      const templateId = "ending_" + item.ending
      h.templateStore.save("local", template(templateId, [
        { id: "send_" + item.ending, type: "send", terminal: { kind: "alias", value: "worker" }, message: { parts: [{ kind: "text", text: "payload" }] }, ending: item.ending },
      ]), h.manager.indexMap("local"))
      await h.service.start("local", { templateId })
      await waitFor(() => h.service.snapshot("local").status === "completed")

      const snapshot = h.service.snapshot("local")
      const event = snapshot.run?.replay.events.find((candidate) => candidate.kind === "terminal_text_sent")
      const content = h.runStore.readArtifact("local", String(snapshot.runId), artifactRef(event, "content"))
      const write = h.runStore.readArtifact("local", String(snapshot.runId), artifactRef(event, "write"))
      expect(content).toBe("payload")
      expect(write).toBe("payload" + item.sequence)
      expect(Array.from(Buffer.from(write)).slice("payload".length)).toEqual(item.bytes)
      expect(h.writes.get("term_worker")?.at(-1)).toBe(write)
      expect(event?.data.ending).toBe(item.ending)
      expect(event?.data.enter).toBeUndefined()
      expect(event?.data.enterSequence).toBeUndefined()
      expect((event?.data.write as { chars?: unknown } | undefined)?.chars).toBe(write.length)
    }
  } finally {
    h.cleanup()
  }
})

test("input and parallel send reuse the exact terminal ending mapping", async () => {
  const h = harness()
  try {
    h.templateStore.save("local", template("input_parallel_endings", [
      { id: "input_lf", type: "input", terminal: { kind: "alias", value: "worker" }, prompt: "Input", allowEmpty: false, ending: "lf" },
      {
        id: "parallel_endings",
        type: "parallel",
        lanes: [{
          id: "reviewer_lane",
          label: "Reviewer",
          terminal: { kind: "alias", value: "reviewer" },
          body: [
            { id: "parallel_send_crlf", type: "send", terminal: { kind: "alias", value: "reviewer" }, message: { parts: [{ kind: "text", text: "lane" }] }, ending: "crlf" },
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

    expect(h.writes.get("term_worker")).toEqual(["answer\n"])
    expect(h.writes.get("term_reviewer")).toEqual(["lane\r\n"])
    const sent = h.service.snapshot("local").run?.replay.events.filter((event) => event.kind === "terminal_text_sent") ?? []
    expect(sent.map((event) => [event.stepId, event.data.ending])).toEqual([
      ["input_lf", "lf"],
      ["parallel_send_crlf", "crlf"],
    ])
  } finally {
    h.cleanup()
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
