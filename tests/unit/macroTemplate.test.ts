import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
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
      { id: "send", type: "send", terminal: { kind: "alias", value: "worker" }, message: { parts: [{ kind: "text", text: "hello" }] }, delivery: "direct", ending: "cr" },
      { id: "capture", type: "capture-source", capture: { kind: "terminal-buffer", terminal: { kind: "alias", value: "worker" }, mode: "scrollback-tail", maxChars: 12000 } },
      { id: "finish_done", type: "finish", reason: "done" },
    ],
  }
}

function oldEnterTemplate(id: string): unknown {
  const value = template(id)
  const send = { ...value.body[0] } as unknown as Record<string, unknown>
  delete send.ending
  send.enter = true
  return { ...value, body: [send, ...value.body.slice(1)] }
}

function missingDeliveryTemplate(id: string): unknown {
  const value = template(id)
  const send = { ...value.body[0] } as unknown as Record<string, unknown>
  delete send.delivery
  return { ...value, body: [send, ...value.body.slice(1)] }
}

function invalidDeliveryTemplate(id: string): unknown {
  const value = template(id)
  const send = { ...value.body[0], delivery: "paste" }
  return { ...value, body: [send, ...value.body.slice(1)] }
}

test("valid Flow V2 macro template uses body and message parts", () => {
  const result = validateMacroTemplate(template(), { indexMap })
  expect(result.ok).toBe(true)
})

test("macro template rejects legacy v1 steps and session fields", () => {
  const legacy = { schemaVersion: 1, id: "legacy", name: "legacy", description: "", configId: "local", steps: [], createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", codexSessionId: "abc" }
  const text = validateMacroTemplate(legacy, { indexMap }).issues.map((issue) => issue.path + ":" + issue.message).join("\n")
  expect(text).toContain("schemaVersion:Flow V2 template schemaVersion must be 2")
  expect(text).toContain("template.steps:extra Flow V2 field is not allowed")
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

test("store hard cuts noncanonical shapes across save, import, read, list and duplicate", () => {
  const root = mkdtempSync(join(tmpdir(), "shell-deck-macro-hard-cut-"))
  try {
    const store = new MacroTemplateStore(root)
    store.save("local", template("valid_current"), indexMap)
    const templateDir = join(root, ".shell-deck", "configs", "local", "templates")
    const baselineFiles = readdirSync(templateDir).sort()
    const oldCount = {
      ...template("old_count"),
      body: [{
        id: "old_loop",
        type: "for",
        range: { count: 2 },
        body: [{ id: "loop_finish", type: "finish", reason: "done" }],
      }],
    }
    const extraTerminalField = {
      ...template("extra_terminal_field"),
      body: template("extra_terminal_field").body.map((node) => node.id === "send"
        ? { ...node, terminal: { kind: "alias", value: "worker", alias: "old" } }
        : node),
    }
    const oldEnter = oldEnterTemplate("old_enter")
    const missingDelivery = missingDeliveryTemplate("missing_delivery")
    const invalidDelivery = invalidDeliveryTemplate("invalid_delivery")
    const missingId = { ...template("missing_id"), id: undefined }
    const missingCreatedAt = { ...template("missing_created_at"), createdAt: undefined }
    const inheritedKindRange = Object.assign(Object.create({ kind: "count" }), { count: 2 })
    const inheritedKind = {
      ...template("inherited_kind"),
      body: [{ id: "inherited_loop", type: "for", range: inheritedKindRange, body: [{ id: "inherited_finish", type: "finish", reason: "done" }] }],
    }

    for (const value of [oldCount, extraTerminalField, oldEnter, missingDelivery, invalidDelivery, missingId, missingCreatedAt, inheritedKind]) {
      expect(() => store.save("local", value as never, indexMap)).toThrow()
      expect(readdirSync(templateDir).sort()).toEqual(baselineFiles)
    }
    for (const value of [oldCount, extraTerminalField, oldEnter, missingDelivery, invalidDelivery, missingId, missingCreatedAt, inheritedKind]) {
      expect(() => store.import("local", value, indexMap)).toThrow("invalid_macro_template")
      expect(readdirSync(templateDir).sort()).toEqual(baselineFiles)
    }

    const diskPath = join(templateDir, "missing_delivery.json")
    const original = JSON.stringify(missingDelivery, null, 2) + "\n"
    writeFileSync(diskPath, original, "utf8")
    const invalidDiskFiles = readdirSync(templateDir).sort()
    expect(() => store.read("local", "missing_delivery")).toThrow("invalid_macro_template")
    expect(() => store.duplicate("local", "missing_delivery", indexMap)).toThrow("invalid_macro_template")
    expect(() => store.list("local")).toThrow("invalid_macro_template")
    expect(readFileSync(diskPath, "utf8")).toBe(original)
    expect(readdirSync(templateDir).sort()).toEqual(invalidDiskFiles)

    const invalidDeliveryOnDisk = invalidDeliveryTemplate("missing_delivery")
    const invalidDeliveryOriginal = JSON.stringify(invalidDeliveryOnDisk, null, 2) + "\n"
    writeFileSync(diskPath, invalidDeliveryOriginal, "utf8")
    expect(() => store.read("local", "missing_delivery")).toThrow("invalid_macro_template")
    expect(() => store.duplicate("local", "missing_delivery", indexMap)).toThrow("invalid_macro_template")
    expect(() => store.list("local")).toThrow("invalid_macro_template")
    expect(readFileSync(diskPath, "utf8")).toBe(invalidDeliveryOriginal)
    expect(readdirSync(templateDir).sort()).toEqual(invalidDiskFiles)

    const oldEnterPath = join(templateDir, "old_enter.json")
    const oldEnterOriginal = JSON.stringify(oldEnter, null, 2) + "\n"
    writeFileSync(oldEnterPath, oldEnterOriginal, "utf8")
    const filesWithOldEnter = readdirSync(templateDir).sort()
    expect(() => store.read("local", "old_enter")).toThrow("invalid_macro_template")
    expect(() => store.duplicate("local", "old_enter", indexMap)).toThrow("invalid_macro_template")
    expect(() => store.list("local")).toThrow("invalid_macro_template")
    expect(readFileSync(oldEnterPath, "utf8")).toBe(oldEnterOriginal)
    expect(readdirSync(templateDir).sort()).toEqual(filesWithOldEnter)
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

    const oldTextList = {
      ...template("legacy_text_list"),
      body: [{
        id: "legacy_loop",
        type: "for",
        range: { kind: "text-list", items: ["legacy item"] },
        body: [{
          id: "legacy_send",
          type: "send",
          terminal: { kind: "alias", value: "worker" },
          message: { parts: [{ kind: "template", template: "{{text}}" }] },
          delivery: "direct",
          ending: "cr",
        }],
      }],
    }
    expect(() => store.save("local", oldTextList as never, indexMap)).toThrow("invalid_macro_template")
    expect(() => store.import("local", oldTextList, indexMap)).toThrow("invalid_macro_template")

    const templateDir = join(root, ".shell-deck", "configs", "local", "templates")
    mkdirSync(templateDir, { recursive: true })
    writeFileSync(join(templateDir, "legacy_text_list.json"), JSON.stringify(oldTextList))
    expect(() => store.read("local", "legacy_text_list")).toThrow("invalid_macro_template")

    writeFileSync(join(templateDir, "legacy.json"), JSON.stringify({ schemaVersion: 1, id: "legacy", steps: [] }))
    expect(() => store.list("local")).toThrow("invalid_macro_template")
    expect(() => store.read("local", "legacy")).toThrow("invalid_macro_template")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
