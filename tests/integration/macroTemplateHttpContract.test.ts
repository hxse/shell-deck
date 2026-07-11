import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, test } from "bun:test"
import { startShellDeckServer } from "../../server/httpServer"
import type { FlowV2Node, MacroTemplate } from "../../src/lib/macro/templateTypes"

type RunningServer = ReturnType<typeof startShellDeckServer>

function template(configId: string, id: string, body: FlowV2Node[]): MacroTemplate {
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

function currentTemplate(configId: string, id: string, terminalId: string): MacroTemplate {
  return template(configId, id, [
    { id: "loop", type: "for", range: { kind: "count", count: 2 }, body: [{ id: "loop_wait", type: "wait", mode: "duration", durationMs: 1 }] },
    { id: "send", type: "send", terminal: { kind: "id", value: terminalId }, message: { parts: [{ kind: "text", text: "current" }] }, enter: false },
    { id: "finish", type: "finish", reason: "done" },
  ])
}

function oldCountTemplate(configId: string, id: string, terminalId: string): unknown {
  const value = currentTemplate(configId, id, terminalId)
  return {
    ...value,
    body: [
      { ...value.body[0], range: { count: 2 } },
      ...value.body.slice(1),
    ],
  }
}

function extraTerminalFieldTemplate(configId: string, id: string, terminalId: string): unknown {
  const value = currentTemplate(configId, id, terminalId)
  return {
    ...value,
    body: value.body.map((node) => node.id === "send"
      ? { ...node, terminal: { kind: "id", value: terminalId, terminalId: "term_old" } }
      : node),
  }
}

function templatePath(root: string, configId: string, templateId: string): string {
  return join(root, ".shell-deck", "configs", configId, "templates", templateId + ".json")
}

async function importTemplate(server: RunningServer, configId: string, value: unknown): Promise<Response> {
  return await fetch(server.url + "/api/configs/" + configId + "/templates/import", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(value),
  })
}

async function putTemplate(server: RunningServer, configId: string, templateId: string, value: unknown): Promise<Response> {
  return await fetch(server.url + "/api/configs/" + configId + "/templates/" + templateId, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(value),
  })
}

async function responseError(response: Response): Promise<string> {
  const body = await response.json() as { error?: unknown }
  return typeof body.error === "string" ? body.error : ""
}

async function validationIssuePaths(response: Response): Promise<string[]> {
  const body = await response.json() as { issues?: Array<{ path?: unknown }> }
  return (body.issues ?? []).map((issue) => typeof issue.path === "string" ? issue.path : "")
}

test("template import and PUT reject old count and extra TerminalRef without creating or rewriting files", async () => {
  const root = mkdtempSync(join(tmpdir(), "shell-deck-template-http-write-"))
  const oldRoot = process.env.SHELL_DECK_DATA_ROOT
  process.env.SHELL_DECK_DATA_ROOT = root
  let server: RunningServer | null = null
  try {
    server = startShellDeckServer({ port: 0, seed: false })
    const configId = "template_http_write"
    server.manager.ensureConfig(configId)
    const terminal = server.manager.createTerminal(configId, { backend: "fake", terminalId: "term_template_http" })

    const invalidImports = [
      { id: "old_count_import", value: oldCountTemplate(configId, "old_count_import", terminal.terminalId), path: "body[0].range.kind" },
      { id: "extra_ref_import", value: extraTerminalFieldTemplate(configId, "extra_ref_import", terminal.terminalId), path: "body[1].terminal.terminalId" },
    ]
    for (const item of invalidImports) {
      const response = await importTemplate(server, configId, item.value)
      expect(response.status).toBe(422)
      const error = await responseError(response)
      expect(error).toStartWith("invalid_macro_template:")
      expect(error).toContain(item.path)
      expect(existsSync(templatePath(root, configId, item.id))).toBe(false)
    }

    const templateId = "tmpl_http_current"
    const imported = await importTemplate(server, configId, currentTemplate(configId, templateId, terminal.terminalId))
    expect(imported.status).toBe(201)
    const filePath = templatePath(root, configId, templateId)
    const before = readFileSync(filePath, "utf8")

    const invalidPuts = [
      { value: oldCountTemplate(configId, templateId, terminal.terminalId), path: "body[0].range.kind" },
      { value: extraTerminalFieldTemplate(configId, templateId, terminal.terminalId), path: "body[1].terminal.terminalId" },
    ]
    for (const item of invalidPuts) {
      const response = await putTemplate(server, configId, templateId, item.value)
      expect(response.status).toBe(422)
      expect(await validationIssuePaths(response)).toContain(item.path)
      expect(readFileSync(filePath, "utf8")).toBe(before)
    }

    const listResponse = await fetch(server.url + "/api/configs/" + configId + "/templates")
    expect(listResponse.status).toBe(200)
    const listBody = await listResponse.json() as { templates: Array<{ id: string }> }
    expect(listBody.templates.map((item) => item.id)).toEqual([templateId])

    const exportResponse = await fetch(server.url + "/api/configs/" + configId + "/templates/" + templateId + "/export")
    expect(exportResponse.status).toBe(200)
    const exported = await exportResponse.json() as MacroTemplate
    expect((exported.body[0] as Extract<FlowV2Node, { type: "for" }>).range).toEqual({ kind: "count", count: 2 })
  } finally {
    server?.stop()
    if (oldRoot === undefined) delete process.env.SHELL_DECK_DATA_ROOT
    else process.env.SHELL_DECK_DATA_ROOT = oldRoot
    rmSync(root, { recursive: true, force: true })
  }
})

test("invalid template file makes read export list and start fail loudly without rewrite or run creation", async () => {
  const root = mkdtempSync(join(tmpdir(), "shell-deck-template-http-read-"))
  const oldRoot = process.env.SHELL_DECK_DATA_ROOT
  process.env.SHELL_DECK_DATA_ROOT = root
  let server: RunningServer | null = null
  try {
    server = startShellDeckServer({ port: 0, seed: false })
    const configId = "template_http_read"
    server.manager.ensureConfig(configId)
    const terminal = server.manager.createTerminal(configId, { backend: "fake", terminalId: "term_template_read" })
    const templateId = "old_count_file"
    const filePath = templatePath(root, configId, templateId)
    mkdirSync(join(root, ".shell-deck", "configs", configId, "templates"), { recursive: true })
    const original = JSON.stringify(oldCountTemplate(configId, templateId, terminal.terminalId), null, 2) + "\n"
    writeFileSync(filePath, original, "utf8")

    const runnerBeforeResponse = await fetch(server.url + "/api/configs/" + configId + "/runner")
    const runnerBeforeBody = await runnerBeforeResponse.json() as { runner: Record<string, unknown> }
    const runnerBefore = runnerBeforeBody.runner
    const readResponse = await fetch(server.url + "/api/configs/" + configId + "/templates/" + templateId)
    expect(readResponse.status).not.toBe(200)
    expect(await responseError(readResponse)).toStartWith("invalid_macro_template:")
    expect(readFileSync(filePath, "utf8")).toBe(original)

    const exportResponse = await fetch(server.url + "/api/configs/" + configId + "/templates/" + templateId + "/export")
    expect(exportResponse.status).not.toBe(200)
    expect(await responseError(exportResponse)).toStartWith("invalid_macro_template:")
    expect(readFileSync(filePath, "utf8")).toBe(original)

    const listResponse = await fetch(server.url + "/api/configs/" + configId + "/templates")
    expect(listResponse.status).not.toBe(200)
    expect(await responseError(listResponse)).toStartWith("invalid_macro_template:")
    expect(readFileSync(filePath, "utf8")).toBe(original)

    const startResponse = await fetch(server.url + "/api/configs/" + configId + "/runner/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ templateId }),
    })
    expect(startResponse.status).toBe(409)
    expect(await responseError(startResponse)).toStartWith("invalid_macro_template:")
    expect(readFileSync(filePath, "utf8")).toBe(original)

    const extraTerminalOriginal = JSON.stringify(extraTerminalFieldTemplate(configId, templateId, terminal.terminalId), null, 2) + "\n"
    writeFileSync(filePath, extraTerminalOriginal, "utf8")
    const extraStartResponse = await fetch(server.url + "/api/configs/" + configId + "/runner/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ templateId }),
    })
    expect(extraStartResponse.status).toBe(409)
    const extraStartError = await responseError(extraStartResponse)
    expect(extraStartError).toStartWith("invalid_macro_template:")
    expect(extraStartError).toContain("body[1].terminal.terminalId")
    expect(readFileSync(filePath, "utf8")).toBe(extraTerminalOriginal)

    const runsResponse = await fetch(server.url + "/api/configs/" + configId + "/runs")
    expect(runsResponse.status).toBe(200)
    const runsBody = await runsResponse.json() as { runs: unknown[] }
    expect(runsBody.runs).toEqual([])
    const runnerResponse = await fetch(server.url + "/api/configs/" + configId + "/runner")
    const runnerBody = await runnerResponse.json() as { runner: Record<string, unknown> }
    expect(runnerBody.runner).toEqual(runnerBefore)
  } finally {
    server?.stop()
    if (oldRoot === undefined) delete process.env.SHELL_DECK_DATA_ROOT
    else process.env.SHELL_DECK_DATA_ROOT = oldRoot
    rmSync(root, { recursive: true, force: true })
  }
})
