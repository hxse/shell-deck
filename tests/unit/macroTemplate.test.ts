import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, test } from "bun:test"
import { MacroTemplateStore } from "../../src/lib/macro/templateStore"
import { validateMacroTemplate } from "../../src/lib/macro/templateSchema"
import type { MacroTemplate } from "../../src/lib/macro/templateTypes"

const indexMap = [{ index: 1, terminalId: "term_1", terminalAlias: "worker" }]

function template(id = "tmpl_v2"): MacroTemplate {
  const now = "2026-01-01T00:00:00.000Z"
  return {
    schemaVersion: 2,
    id,
    name: "V2 Macro",
    description: "",
    configId: "local",
    createdAt: now,
    updatedAt: now,
    body: [
      { id: "send", type: "send_line", terminal: { kind: "alias", value: "worker" }, message: { parts: [{ kind: "text", text: "hello" }] } },
      { id: "capture", type: "capture-source", capture: { kind: "terminal-buffer", terminal: { kind: "alias", value: "worker" }, mode: "scrollback-tail", maxChars: 12000 } },
      { id: "finish_done", type: "finish", reason: "done" },
    ],
  }
}

test("valid Flow V2 macro template uses body and message parts", () => {
  const result = validateMacroTemplate(template(), { indexMap })
  expect(result.ok).toBe(true)
})

test("macro template rejects legacy v1 steps and session fields", () => {
  const legacy = { schemaVersion: 1, id: "legacy", name: "legacy", description: "", configId: "local", steps: [], createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", codexSessionId: "abc" }
  const text = validateMacroTemplate(legacy, { indexMap }).issues.map((issue) => issue.path + ":" + issue.message).join("\n")
  expect(text).toContain("schemaVersion:Flow V2 template schemaVersion must be 2")
  expect(text).toContain("steps:legacy control/parser fields are not allowed in Flow V2")
  expect(text).toContain("codexSessionId:macro template must not persist Codex session fields")
})

test("store creates, saves, duplicates and imports Flow V2 templates", () => {
  const root = mkdtempSync(join(tmpdir(), "shell-deck-macro-v2-"))
  try {
    const store = new MacroTemplateStore(root)
    const created = store.create("local", indexMap)
    expect(created.schemaVersion).toBe(2)
    expect(created.body).toEqual([])

    const saved = store.save("local", { ...template("saved"), configId: "local" }, indexMap)
    expect(store.read("local", saved.id).body).toHaveLength(3)
    expect(store.list("local").some((item) => item.id === saved.id && item.stepCount === 3)).toBe(true)

    const duplicate = store.duplicate("local", saved.id, indexMap)
    expect(duplicate.id).not.toBe(saved.id)
    expect(duplicate.schemaVersion).toBe(2)

    const imported = store.import("local", { ...template("imported"), configId: "elsewhere" }, indexMap)
    expect(imported.id).toBe("imported")
    expect(imported.configId).toBe("local")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("store fails loudly on invalid template imports and files", () => {
  const root = mkdtempSync(join(tmpdir(), "shell-deck-macro-invalid-"))
  try {
    const store = new MacroTemplateStore(root)
    store.save("local", template("valid"), indexMap)
    expect(() => store.import("local", { schemaVersion: 1, id: "legacy", steps: [] }, indexMap)).toThrow("invalid_macro_template")
    expect(() => store.import("local", "not a template", indexMap)).toThrow("invalid_macro_template")
    expect(store.list("local").map((item) => item.id)).toContain("valid")

    const templateDir = join(root, ".shell-deck", "configs", "local", "templates")
    mkdirSync(templateDir, { recursive: true })
    writeFileSync(join(templateDir, "legacy.json"), JSON.stringify({ schemaVersion: 1, id: "legacy", steps: [] }))
    expect(() => store.list("local")).toThrow("invalid_macro_template")
    expect(() => store.read("local", "legacy")).toThrow("invalid_macro_template")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
