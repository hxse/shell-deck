import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, test } from "bun:test"
import { AgentEventStore } from "../../src/lib/agentEvents/agentEventStore"
import { MacroTemplateStore } from "../../src/lib/macro/templateStore"
import type { MacroTemplate } from "../../src/lib/macro/templateTypes"
import { ParserRuntime } from "../../src/lib/parser/parserRuntime"
import { RunEventStore } from "../../src/lib/runLog/runEventStore"
import { MacroRunnerService } from "../../server/macroRunnerService"
import type {
  NotificationDispatcher,
  TelegramNotificationRequest,
  TelegramNotificationResult,
} from "../../server/notificationService"
import { TerminalDeckManager } from "../../server/terminalDeckManager"

const worker = { kind: "alias" as const, value: "worker" }
const reviewer = { kind: "alias" as const, value: "reviewer" }
const collector = { kind: "alias" as const, value: "collector" }

function harness(dispatcher: NotificationDispatcher = successfulNotificationDispatcher()) {
  const root = mkdtempSync(join(tmpdir(), "shell-deck-runner-text-list-"))
  const manager = new TerminalDeckManager()
  manager.createTerminal("local", { backend: "fake", terminalAlias: "worker" })
  manager.createTerminal("local", { backend: "fake", terminalAlias: "reviewer" })
  manager.createTerminal("local", { backend: "text", terminalAlias: "collector" })
  const runStore = new RunEventStore(root)
  const templateStore = new MacroTemplateStore(root)
  const agentStore = new AgentEventStore(root)
  const service = new MacroRunnerService(
    manager,
    templateStore,
    runStore,
    agentStore,
    new ParserRuntime(runStore),
    dispatcher,
  )
  return {
    root,
    manager,
    runStore,
    templateStore,
    service,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  }
}

type Harness = ReturnType<typeof harness>

function successfulNotificationDispatcher(): NotificationDispatcher {
  return {
    async sendTelegram(request) {
      return { ok: true, profileId: request.profileId, status: 200 }
    },
  }
}

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

function nestedArtifactRef(event: { data: Record<string, unknown> } | undefined, key: "content" | "write"): string {
  const value = event?.data[key]
  if (!value || typeof value !== "object" || !("artifactRef" in value)) return ""
  return String((value as { artifactRef: unknown }).artifactRef)
}

function sentContents(h: Harness, stepId: string): string[] {
  const snapshot = h.service.snapshot("local")
  const runId = String(snapshot.runId)
  return (snapshot.run?.replay.events ?? [])
    .filter((event) => event.kind === "terminal_text_sent" && event.stepId === stepId)
    .map((event) => h.runStore.readArtifact("local", runId, nestedArtifactRef(event, "content")))
}

function events(h: Harness) {
  return h.service.snapshot("local").run?.replay.events ?? []
}

test("text-list preserves item order and bytes while template rendering is one-pass and text parts stay literal", async () => {
  const h = harness()
  try {
    const firstItem = "  阶段 1\n下一行  "
    h.templateStore.save("local", template("text_list_rendering", [
      {
        id: "loop",
        type: "for",
        range: { kind: "text-list", items: [firstItem, "{{text}}"] },
        body: [
          {
            id: "send_item",
            type: "send",
            terminal: worker,
            message: {
              parts: [
                { kind: "template", template: "A{{text}}B/{{text}}" },
                { kind: "text", text: "/literal={{text}}" },
              ],
            },
            enter: false,
          },
        ],
      },
    ]), h.manager.indexMap("local"))

    await h.service.start("local", { templateId: "text_list_rendering" })
    await waitFor(() => h.service.snapshot("local").status === "completed")

    expect(sentContents(h, "send_item")).toEqual([
      `A${firstItem}B/${firstItem}/literal={{text}}`,
      "A{{text}}B/{{text}}/literal={{text}}",
    ])
    const paths = events(h)
      .filter((event) => event.kind === "terminal_text_sent" && event.stepId === "send_item")
      .map((event) => event.data.executionPath)
    expect(paths).toEqual([
      [{ kind: "for", stepId: "loop", iterationIndex: 0 }],
      [{ kind: "for", stepId: "loop", iterationIndex: 1 }],
    ])
  } finally {
    h.cleanup()
  }
})

test("capture and extract resolve the artifact produced by the same text-list iteration", async () => {
  const h = harness()
  try {
    h.templateStore.save("local", template("iteration_local_artifact", [
      {
        id: "loop",
        type: "for",
        range: { kind: "text-list", items: ["alpha", "beta"] },
        body: [
          {
            id: "send_item",
            type: "send",
            terminal: worker,
            message: { parts: [{ kind: "template", template: "{{text}}" }] },
            enter: true,
          },
          {
            id: "capture_item",
            type: "capture-source",
            capture: { kind: "terminal-buffer", terminal: worker, mode: "scrollback-tail", maxChars: 12000 },
          },
          {
            id: "extract_item",
            type: "extract_text",
            source: { kind: "step_artifact", stepId: "capture_item", artifact: "captured_text" },
            split: { kind: "lines", keepEmpty: false },
            filters: [{ kind: "exclude", matcher: { kind: "regex", pattern: "^\\s*[$#>]\\s*$" } }],
            select: { mode: "index", index: -1 },
            extract: { kind: "regex", pattern: "^ECHO:(.*)$", group: 1 },
            trim: "both",
            onEmpty: "fail",
          },
          {
            id: "forward_item",
            type: "send",
            terminal: reviewer,
            message: { parts: [{ kind: "artifact", source: { kind: "step_artifact", stepId: "extract_item", artifact: "extracted_text" } }] },
            enter: false,
          },
        ],
      },
    ]), h.manager.indexMap("local"))

    await h.service.start("local", { templateId: "iteration_local_artifact" })
    await waitFor(() => h.service.snapshot("local").status === "completed")

    expect(sentContents(h, "forward_item")).toEqual(["alpha", "beta"])
    expect(events(h).filter((event) => event.kind === "capture_artifact_created" && event.stepId === "capture_item")).toHaveLength(2)
    expect(events(h).filter((event) => event.kind === "text_extracted" && event.stepId === "extract_item")).toHaveLength(2)
  } finally {
    h.cleanup()
  }
})

test("nested count inherits the outer text binding and nested text-list shadows then restores it", async () => {
  const h = harness()
  try {
    h.templateStore.save("local", template("nested_text_bindings", [
      {
        id: "outer_loop",
        type: "for",
        range: { kind: "text-list", items: ["OUT-A", "OUT-B"] },
        body: [
          { id: "outer_before", type: "send", terminal: worker, message: { parts: [{ kind: "template", template: "before={{text}}" }] }, enter: false },
          {
            id: "count_loop",
            type: "for",
            range: { kind: "count", count: 2 },
            body: [
              { id: "count_send", type: "send", terminal: worker, message: { parts: [{ kind: "template", template: "count={{text}}" }] }, enter: false },
            ],
          },
          {
            id: "inner_loop",
            type: "for",
            range: { kind: "text-list", items: ["INNER-1", "INNER-2"] },
            body: [
              { id: "inner_send", type: "send", terminal: worker, message: { parts: [{ kind: "template", template: "inner={{text}}" }] }, enter: false },
            ],
          },
          { id: "outer_after", type: "send", terminal: worker, message: { parts: [{ kind: "template", template: "after={{text}}" }] }, enter: false },
        ],
      },
    ]), h.manager.indexMap("local"))

    await h.service.start("local", { templateId: "nested_text_bindings" })
    await waitFor(() => h.service.snapshot("local").status === "completed")

    expect(sentContents(h, "outer_before")).toEqual(["before=OUT-A", "before=OUT-B"])
    expect(sentContents(h, "count_send")).toEqual([
      "count=OUT-A",
      "count=OUT-A",
      "count=OUT-B",
      "count=OUT-B",
    ])
    expect(sentContents(h, "inner_send")).toEqual([
      "inner=INNER-1",
      "inner=INNER-2",
      "inner=INNER-1",
      "inner=INNER-2",
    ])
    expect(sentContents(h, "outer_after")).toEqual(["after=OUT-A", "after=OUT-B"])
  } finally {
    h.cleanup()
  }
})

test("parallel lane sends inherit the enclosing text-list binding", async () => {
  const h = harness()
  try {
    h.templateStore.save("local", template("parallel_text_binding", [
      {
        id: "loop",
        type: "for",
        range: { kind: "text-list", items: ["X", "Y"] },
        body: [
          {
            id: "parallel",
            type: "parallel",
            lanes: [
              {
                id: "docs",
                label: "Docs",
                terminal: worker,
                body: [
                  { id: "send_docs", type: "send", terminal: worker, message: { parts: [{ kind: "template", template: "docs={{text}}" }] }, enter: false },
                  { id: "output_docs", type: "output", source: { kind: "none" } },
                ],
              },
              {
                id: "tests",
                label: "Tests",
                terminal: reviewer,
                body: [
                  { id: "send_tests", type: "send", terminal: reviewer, message: { parts: [{ kind: "template", template: "tests={{text}}" }] }, enter: false },
                  { id: "output_tests", type: "output", source: { kind: "none" } },
                ],
              },
            ],
            merge: { kind: "sectioned_text", separator: "===== {laneId} =====", includeEmptyOutputs: true },
            onLaneFail: "fail",
          },
        ],
      },
    ]), h.manager.indexMap("local"))

    await h.service.start("local", { templateId: "parallel_text_binding" })
    await waitFor(() => h.service.snapshot("local").status === "completed")

    expect(sentContents(h, "send_docs")).toEqual(["docs=X", "docs=Y"])
    expect(sentContents(h, "send_tests")).toEqual(["tests=X", "tests=Y"])
    const docsPaths = events(h)
      .filter((event) => event.kind === "terminal_text_sent" && event.stepId === "send_docs")
      .map((event) => event.data.executionPath)
    expect(docsPaths).toEqual([
      [
        { kind: "for", stepId: "loop", iterationIndex: 0 },
        { kind: "parallel-lane", stepId: "parallel", laneId: "docs" },
      ],
      [
        { kind: "for", stepId: "loop", iterationIndex: 1 },
        { kind: "parallel-lane", stepId: "parallel", laneId: "docs" },
      ],
    ])
  } finally {
    h.cleanup()
  }
})

test("duration wait resumes the current text-list occurrence without repeating its preceding send", async () => {
  const h = harness()
  try {
    h.templateStore.save("local", template("duration_resume_cursor", [
      {
        id: "loop",
        type: "for",
        range: { kind: "text-list", items: ["A", "B"] },
        body: [
          { id: "before_wait", type: "send", terminal: worker, message: { parts: [{ kind: "template", template: "before={{text}}" }] }, enter: false },
          { id: "duration_wait", type: "wait", mode: "duration", durationMs: 300 },
          { id: "after_wait", type: "send", terminal: worker, message: { parts: [{ kind: "template", template: "after={{text}}" }] }, enter: false },
        ],
      },
    ]), h.manager.indexMap("local"))

    await h.service.start("local", { templateId: "duration_resume_cursor" })
    await waitFor(() => events(h).some((event) => event.kind === "wait_started" && event.stepId === "duration_wait"))
    await Bun.sleep(70)
    await h.service.pause("local")
    await Bun.sleep(80)

    expect(h.service.snapshot("local").status).toBe("paused")
    expect(sentContents(h, "before_wait")).toEqual(["before=A"])
    expect(sentContents(h, "after_wait")).toEqual([])

    await h.service.resume("local")
    await waitFor(() => h.service.snapshot("local").status === "completed", 4000)

    expect(sentContents(h, "before_wait")).toEqual(["before=A", "before=B"])
    expect(sentContents(h, "after_wait")).toEqual(["after=A", "after=B"])
    expect(events(h).filter((event) => event.kind === "wait_started" && event.stepId === "duration_wait")).toHaveLength(2)
    expect(events(h).filter((event) => event.kind === "step_started" && event.stepId === "before_wait")).toHaveLength(2)
  } finally {
    h.cleanup()
  }
})

test("user-continue and input resume each text-list occurrence without replaying earlier sends", async () => {
  const h = harness()
  try {
    h.templateStore.save("local", template("interactive_resume_cursor", [
      {
        id: "loop",
        type: "for",
        range: { kind: "text-list", items: ["first", "second"] },
        body: [
          { id: "before_interaction", type: "send", terminal: worker, message: { parts: [{ kind: "template", template: "before={{text}}" }] }, enter: false },
          { id: "continue_wait", type: "wait", mode: "user-continue", prompt: { kind: "template", template: "Continue {{text}}" } },
          { id: "input_item", type: "input", terminal: worker, prompt: { kind: "template", template: "Input {{text}}" }, allowEmpty: false, enter: false },
          { id: "after_interaction", type: "send", terminal: worker, message: { parts: [{ kind: "template", template: "after={{text}}" }] }, enter: false },
        ],
      },
    ]), h.manager.indexMap("local"))

    await h.service.start("local", { templateId: "interactive_resume_cursor" })
    await waitFor(() => h.service.snapshot("local").status === "waiting")
    expect(h.service.snapshot("local").pauseReason?.message).toBe("Continue first")

    await h.service.resume("local")
    await waitFor(() => h.service.snapshot("local").status === "waiting_user_input")
    expect(h.service.snapshot("local").waitingInput?.prompt).toBe("Input first")
    expect(sentContents(h, "before_interaction")).toEqual(["before=first"])

    await h.service.submitInput("local", "answer-first")
    await waitFor(() => h.service.snapshot("local").status === "waiting")
    expect(h.service.snapshot("local").pauseReason?.message).toBe("Continue second")
    expect(sentContents(h, "before_interaction")).toEqual(["before=first", "before=second"])
    expect(sentContents(h, "after_interaction")).toEqual(["after=first"])

    await h.service.resume("local")
    await waitFor(() => h.service.snapshot("local").status === "waiting_user_input")
    expect(h.service.snapshot("local").waitingInput?.prompt).toBe("Input second")
    await h.service.submitInput("local", "answer-second")
    await waitFor(() => h.service.snapshot("local").status === "completed")

    expect(sentContents(h, "before_interaction")).toEqual(["before=first", "before=second"])
    expect(sentContents(h, "input_item")).toEqual(["answer-first", "answer-second"])
    expect(sentContents(h, "after_interaction")).toEqual(["after=first", "after=second"])
    expect(events(h).filter((event) => event.kind === "user_input_requested" && event.stepId === "input_item")).toHaveLength(2)
    expect(events(h).filter((event) => event.kind === "wait_manual_continue" && event.stepId === "continue_wait")).toHaveLength(2)
  } finally {
    h.cleanup()
  }
})

test("a paused if body resumes its selected branch without recapturing, re-deciding or replaying", async () => {
  const h = harness()
  try {
    h.manager.setTextContent("local", collector, "GO")
    h.templateStore.save("local", template("if_resume_cursor", [
      { id: "capture_decision", type: "capture-source", capture: { kind: "text-box", terminal: collector } },
      {
        id: "choose_branch",
        type: "if",
        branches: [
          {
            kind: "if",
            condition: {
              kind: "text_match",
              source: { kind: "step_artifact", stepId: "capture_decision", artifact: "captured_text" },
              matcher: { kind: "simple", op: "contains", text: "GO" },
              scope: { kind: "whole" },
            },
            body: [
              { id: "chosen_before", type: "send", terminal: worker, message: { parts: [{ kind: "text", text: "chosen-before" }] }, enter: false },
              { id: "chosen_wait", type: "wait", mode: "duration", durationMs: 300 },
              { id: "chosen_after", type: "send", terminal: worker, message: { parts: [{ kind: "text", text: "chosen-after" }] }, enter: false },
            ],
          },
        ],
        else: [
          { id: "wrong_branch", type: "send", terminal: worker, message: { parts: [{ kind: "text", text: "wrong-branch" }] }, enter: false },
        ],
      },
    ]), h.manager.indexMap("local"))

    await h.service.start("local", { templateId: "if_resume_cursor" })
    await waitFor(() => events(h).some((event) => event.kind === "wait_started" && event.stepId === "chosen_wait"))
    await Bun.sleep(70)
    await h.service.pause("local")
    await Bun.sleep(80)
    h.manager.setTextContent("local", collector, "STOP")

    await h.service.resume("local")
    await waitFor(() => h.service.snapshot("local").status === "completed", 3000)

    expect(sentContents(h, "chosen_before")).toEqual(["chosen-before"])
    expect(sentContents(h, "chosen_after")).toEqual(["chosen-after"])
    expect(sentContents(h, "wrong_branch")).toEqual([])
    expect(events(h).filter((event) => event.kind === "capture_artifact_created" && event.stepId === "capture_decision")).toHaveLength(1)
    expect(events(h).filter((event) => event.kind === "branch_decision" && event.stepId === "choose_branch")).toHaveLength(1)
    expect(events(h).filter((event) => event.kind === "step_started" && event.stepId === "choose_branch")).toHaveLength(1)
  } finally {
    h.cleanup()
  }
})

test("partial notify resume retries only the failed Telegram profile", async () => {
  const telegramRequests: TelegramNotificationRequest[] = []
  let profileBAttempts = 0
  const dispatcher: NotificationDispatcher = {
    async sendTelegram(request): Promise<TelegramNotificationResult> {
      telegramRequests.push(request)
      if (request.profileId === "profile-b") {
        profileBAttempts += 1
        if (profileBAttempts === 1) {
          return { ok: false, profileId: request.profileId, code: "temporary_failure", message: "retry me" }
        }
      }
      return { ok: true, profileId: request.profileId, status: 200 }
    },
  }
  const h = harness(dispatcher)
  try {
    const browserMessages: unknown[] = []
    h.manager.connectClient("local", (message) => browserMessages.push(message), "notify-client")
    h.templateStore.save("local", template("partial_notify_resume", [
      {
        id: "loop",
        type: "for",
        range: { kind: "text-list", items: ["notice"] },
        body: [
          {
            id: "notify_item",
            type: "notify",
            level: "warning",
            title: { kind: "template", template: "Title {{text}}" },
            message: { parts: [{ kind: "template", template: "Message {{text}}" }] },
            channels: [
              { kind: "app", toast: true, sound: "bell" },
              { kind: "telegram", profileId: "profile-a" },
              { kind: "telegram", profileId: "profile-b" },
            ],
            onFailure: "pause",
          },
        ],
      },
    ]), h.manager.indexMap("local"))

    await h.service.start("local", { templateId: "partial_notify_resume" })
    await waitFor(() => h.service.snapshot("local").status === "paused")

    expect(telegramRequests.map((request) => request.profileId)).toEqual(["profile-a", "profile-b"])
    expect(browserMessages.filter(isMacroNotification)).toHaveLength(1)
    expect(browserMessages.filter(isMacroNotification)[0]).toMatchObject({ title: "Title notice", message: "Message notice" })

    await h.service.resume("local")
    await waitFor(() => h.service.snapshot("local").status === "completed")

    expect(telegramRequests.map((request) => request.profileId)).toEqual(["profile-a", "profile-b", "profile-b"])
    expect(browserMessages.filter(isMacroNotification)).toHaveLength(1)
    expect(events(h).filter((event) => event.kind === "notification_requested" && event.stepId === "notify_item")).toHaveLength(1)
    expect(events(h).filter((event) => event.kind === "notification_delivered" && event.stepId === "notify_item" && notificationProfile(event.data) === "profile-a")).toHaveLength(1)
    expect(events(h).filter((event) => event.kind === "notification_delivered" && event.stepId === "notify_item" && notificationProfile(event.data) === "profile-b")).toHaveLength(1)
    expect(events(h).filter((event) => event.kind === "notification_failed" && event.stepId === "notify_item" && notificationProfile(event.data) === "profile-b")).toHaveLength(1)
  } finally {
    h.cleanup()
  }
})

function isMacroNotification(message: unknown): message is { type: "macro_notification"; title: string; message: string } {
  return Boolean(message) && typeof message === "object" && (message as { type?: unknown }).type === "macro_notification"
}

function notificationProfile(data: Record<string, unknown>): string | undefined {
  const channel = data.channel
  if (!channel || typeof channel !== "object" || !("profileId" in channel)) return undefined
  return String((channel as { profileId: unknown }).profileId)
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await Bun.sleep(20)
  }
  throw new Error("condition_timeout")
}
