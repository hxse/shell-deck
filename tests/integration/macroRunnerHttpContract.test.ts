import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, test } from "bun:test"
import { startShellDeckServer } from "../../server/httpServer"
import type { MacroTemplate } from "../../src/lib/macro/templateTypes"

type RunningServer = ReturnType<typeof startShellDeckServer>
type RunnerAction = "start" | "pause" | "resume" | "stop" | "input"

function template(configId: string, id: string, body: MacroTemplate["body"]): MacroTemplate {
  const now = "2026-07-11T00:00:00.000Z"
  return {
    schemaVersion: 2,
    id,
    name: id,
    description: "",
    configId,
    body,
    createdAt: now,
    updatedAt: now,
  }
}

async function postRaw(server: RunningServer, configId: string, action: RunnerAction, rawBody?: string): Promise<Response> {
  return await fetch(server.url + "/api/configs/" + configId + "/runner/" + action, {
    method: "POST",
    headers: { "content-type": "application/json" },
    ...(rawBody === undefined ? {} : { body: rawBody }),
  })
}

async function postJson(server: RunningServer, configId: string, action: RunnerAction, body: unknown): Promise<Response> {
  return await postRaw(server, configId, action, JSON.stringify(body))
}

async function responseError(response: Response): Promise<string> {
  const body = await response.json() as { error?: unknown }
  return typeof body.error === "string" ? body.error : ""
}

async function runnerSnapshot(server: RunningServer, configId: string): Promise<Record<string, unknown>> {
  const response = await fetch(server.url + "/api/configs/" + configId + "/runner")
  expect(response.status).toBe(200)
  const body = await response.json() as { runner: Record<string, unknown> }
  return body.runner
}

async function importTemplate(server: RunningServer, configId: string, value: MacroTemplate): Promise<void> {
  const response = await fetch(server.url + "/api/configs/" + configId + "/templates/import", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(value),
  })
  expect(response.status).toBe(201)
}

async function waitFor(check: () => Promise<boolean>, timeoutMs = 1500): Promise<void> {
  const startedAt = Date.now()
  while (!(await check())) {
    if (Date.now() - startedAt > timeoutMs) throw new Error("wait_for_timeout")
    await Bun.sleep(10)
  }
}

test("runner HTTP rejects non-object and malformed bodies with 422 before config or runner dispatch", async () => {
  const root = mkdtempSync(join(tmpdir(), "shell-deck-runner-http-body-"))
  const oldRoot = process.env.SHELL_DECK_DATA_ROOT
  process.env.SHELL_DECK_DATA_ROOT = root
  let server: RunningServer | null = null
  try {
    server = startShellDeckServer({ port: 0, seed: false })
    const cases: Array<{ name: string; rawBody: string }> = [
      { name: "invalid-json", rawBody: "{" },
      { name: "whitespace-only", rawBody: "   " },
      { name: "null", rawBody: "null" },
      { name: "array", rawBody: "[]" },
      { name: "string", rawBody: JSON.stringify("body") },
      { name: "number", rawBody: "1" },
      { name: "boolean", rawBody: "true" },
    ]

    for (const item of cases) {
      const configId = "runner_body_" + item.name.replaceAll("-", "_")
      expect(server.manager.configs.has(configId)).toBe(false)
      const response = await postRaw(server, configId, "pause", item.rawBody)
      expect(response.status).toBe(422)
      expect(await responseError(response)).toBe("runner_request_invalid_field:pause:body")
      expect(server.manager.configs.has(configId)).toBe(false)
    }
  } finally {
    server?.stop()
    if (oldRoot === undefined) delete process.env.SHELL_DECK_DATA_ROOT
    else process.env.SHELL_DECK_DATA_ROOT = oldRoot
    rmSync(root, { recursive: true, force: true })
  }
})

test("runner HTTP enforces each action exact keys and separates 422 syntax from 409 runtime", async () => {
  const root = mkdtempSync(join(tmpdir(), "shell-deck-runner-http-keys-"))
  const oldRoot = process.env.SHELL_DECK_DATA_ROOT
  process.env.SHELL_DECK_DATA_ROOT = root
  let server: RunningServer | null = null
  try {
    server = startShellDeckServer({ port: 0, seed: false })
    const syntaxCases: Array<{ action: RunnerAction; body: unknown; error: string }> = [
      { action: "start", body: {}, error: "runner_request_missing_field:start:templateId" },
      { action: "start", body: { templateId: 7 }, error: "runner_request_invalid_field:start:templateId" },
      { action: "start", body: { templateId: "" }, error: "runner_request_invalid_field:start:templateId" },
      { action: "start", body: { mockCaptureText: "old" }, error: "runner_request_unknown_field:start:mockCaptureText" },
      { action: "start", body: { templateId: "missing", mockCaptureReady: true }, error: "runner_request_unknown_field:start:mockCaptureReady" },
      { action: "pause", body: { reason: "old" }, error: "runner_request_unknown_field:pause:reason" },
      { action: "resume", body: { nextStepId: "send_2" }, error: "runner_request_unknown_field:resume:nextStepId" },
      { action: "stop", body: { reason: "old" }, error: "runner_request_unknown_field:stop:reason" },
      { action: "input", body: {}, error: "runner_request_missing_field:input:text" },
      { action: "input", body: { text: 7 }, error: "runner_request_invalid_field:input:text" },
      { action: "input", body: { text: "answer", extra: true }, error: "runner_request_unknown_field:input:extra" },
    ]

    for (const [index, item] of syntaxCases.entries()) {
      const configId = "runner_syntax_" + index
      const response = await postJson(server, configId, item.action, item.body)
      expect(response.status).toBe(422)
      expect(await responseError(response)).toBe(item.error)
      expect(server.manager.configs.has(configId)).toBe(false)
    }

    const runtimeCases: Array<{ action: RunnerAction; body: unknown; error: string }> = [
      { action: "start", body: { templateId: "missing_template" }, error: "template_not_found:missing_template" },
      { action: "pause", body: {}, error: "runner_idle" },
      { action: "resume", body: {}, error: "runner_idle" },
      { action: "stop", body: {}, error: "runner_idle" },
      { action: "input", body: { text: "" }, error: "runner_idle" },
    ]
    for (const [index, item] of runtimeCases.entries()) {
      const response = await postJson(server, "runner_runtime_" + index, item.action, item.body)
      expect(response.status).toBe(409)
      expect(await responseError(response)).toBe(item.error)
    }

    const emptyBodyCases: Array<{ action: RunnerAction; status: number; error: string }> = [
      { action: "start", status: 422, error: "runner_request_missing_field:start:templateId" },
      { action: "pause", status: 409, error: "runner_idle" },
      { action: "resume", status: 409, error: "runner_idle" },
      { action: "stop", status: 409, error: "runner_idle" },
      { action: "input", status: 422, error: "runner_request_missing_field:input:text" },
    ]
    for (const item of emptyBodyCases) {
      const configId = "runner_empty_body_" + item.action
      const response = await postRaw(server, configId, item.action)
      expect(response.status).toBe(item.status)
      expect(await responseError(response)).toBe(item.error)
      expect(server.manager.configs.has(configId)).toBe(item.status === 409)
    }
  } finally {
    server?.stop()
    if (oldRoot === undefined) delete process.env.SHELL_DECK_DATA_ROOT
    else process.env.SHELL_DECK_DATA_ROOT = oldRoot
    rmSync(root, { recursive: true, force: true })
  }
})

test("rejected resume request cannot consume a manual-wait cursor or append run events", async () => {
  const root = mkdtempSync(join(tmpdir(), "shell-deck-runner-http-resume-"))
  const oldRoot = process.env.SHELL_DECK_DATA_ROOT
  process.env.SHELL_DECK_DATA_ROOT = root
  let server: RunningServer | null = null
  try {
    server = startShellDeckServer({ port: 0, seed: false })
    const configId = "runner_resume_side_effect"
    const templateId = "resume_contract"
    await importTemplate(server, configId, template(configId, templateId, [
      { id: "manual_wait", type: "wait", mode: "user-continue", prompt: "Continue" },
      { id: "finish", type: "finish", reason: "done" },
    ]))
    const start = await postJson(server, configId, "start", { templateId })
    expect(start.status).toBe(200)
    await waitFor(async () => (await runnerSnapshot(server!, configId)).status === "waiting")

    const before = await runnerSnapshot(server, configId)
    const beforeRun = before.run as { replay?: { events?: unknown[] } }
    const beforeEventCount = beforeRun.replay?.events?.length ?? 0
    const rejected = await postJson(server, configId, "resume", { nextStepId: "finish" })
    expect(rejected.status).toBe(422)
    expect(await responseError(rejected)).toBe("runner_request_unknown_field:resume:nextStepId")

    const after = await runnerSnapshot(server, configId)
    const afterRun = after.run as { replay?: { events?: unknown[] } }
    expect(after.status).toBe("waiting")
    expect(after.currentStepId).toBe(before.currentStepId)
    expect(after.runId).toBe(before.runId)
    expect(afterRun.replay?.events?.length ?? 0).toBe(beforeEventCount)

    const resumed = await postJson(server, configId, "resume", {})
    expect(resumed.status).toBe(200)
    await waitFor(async () => (await runnerSnapshot(server!, configId)).status === "completed")
  } finally {
    server?.stop()
    if (oldRoot === undefined) delete process.env.SHELL_DECK_DATA_ROOT
    else process.env.SHELL_DECK_DATA_ROOT = oldRoot
    rmSync(root, { recursive: true, force: true })
  }
})
