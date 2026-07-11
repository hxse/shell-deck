import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import shortUuid from "short-uuid"
import { assertValidPublicId } from "../identifier"
import type { TerminalIndexMapItem } from "../protocol"
import { assertValidMacroTemplate, validateMacroTemplate } from "./templateSchema"
import type { MacroTemplate, TemplateSummary, ValidationResult } from "./templateTypes"

const translator = shortUuid()

export class MacroTemplateStore {
  readonly rootDir: string

  constructor(rootDir = process.env.SHELL_DECK_DATA_ROOT ?? process.cwd()) {
    this.rootDir = rootDir
  }

  list(configId: string): TemplateSummary[] {
    const dir = this.templatesDir(configId)
    if (!existsSync(dir)) return []
    const templates = readdirSync(dir)
      .filter((fileName) => fileName.endsWith(".json"))
      .map((fileName) => this.read(configId, fileName.slice(0, -".json".length)))
    return templates
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((template) => ({
        id: template.id,
        name: template.name,
        description: template.description,
        updatedAt: template.updatedAt,
        stepCount: countNodes(template.body),
      }))
  }

  read(configId: string, templateId: string): MacroTemplate {
    const path = this.templatePath(configId, templateId)
    if (!existsSync(path)) throw new Error("template_not_found:" + templateId)
    return parseCurrentTemplate(JSON.parse(readFileSync(path, "utf8")))
  }

  create(configId: string, indexMap: TerminalIndexMapItem[] = []): MacroTemplate {
    const now = new Date().toISOString()
    const template: MacroTemplate = {
      schemaVersion: 2,
      id: createTemplateId(),
      name: "New Macro Template",
      description: "",
      configId: assertValidPublicId(configId, "configId"),
      body: [],
      createdAt: now,
      updatedAt: now,
    }
    return this.save(configId, template, indexMap)
  }

  save(configId: string, template: MacroTemplate, indexMap: TerminalIndexMapItem[] = []): MacroTemplate {
    const normalizedConfigId = assertValidPublicId(configId, "configId")
    if (template.configId !== normalizedConfigId) throw new Error("template_config_mismatch:" + template.configId + ":" + normalizedConfigId)
    const next: MacroTemplate = { ...template, id: assertValidPublicId(template.id, "genericId"), configId: normalizedConfigId, updatedAt: new Date().toISOString() }
    assertValidMacroTemplate(next, { indexMap })
    mkdirSync(this.templatesDir(normalizedConfigId), { recursive: true })
    const path = this.templatePath(normalizedConfigId, next.id)
    const tmpPath = path + ".tmp"
    writeFileSync(tmpPath, JSON.stringify(next, null, 2) + "\n")
    renameSync(tmpPath, path)
    return next
  }

  duplicate(configId: string, templateId: string, indexMap: TerminalIndexMapItem[] = []): MacroTemplate {
    const source = this.read(configId, templateId)
    const now = new Date().toISOString()
    const copy: MacroTemplate = { ...source, id: createTemplateId(), name: source.name + " Copy", createdAt: now, updatedAt: now }
    return this.save(configId, copy, indexMap)
  }

  delete(configId: string, templateId: string): void {
    const path = this.templatePath(configId, templateId)
    if (existsSync(path)) unlinkSync(path)
  }

  import(configId: string, value: unknown, indexMap: TerminalIndexMapItem[] = []): MacroTemplate {
    const incoming = parseCurrentTemplate(value)
    const now = new Date().toISOString()
    const candidateId = incoming.id
    const id = existsSync(this.templatePath(configId, candidateId)) ? createTemplateId() : candidateId
    const template: MacroTemplate = { ...incoming, id, configId: assertValidPublicId(configId, "configId"), createdAt: incoming.createdAt, updatedAt: now }
    return this.save(configId, template, indexMap)
  }

  validate(template: unknown, indexMap: TerminalIndexMapItem[] = []): ValidationResult {
    return validateMacroTemplate(template, { indexMap })
  }

  private templatesDir(configId: string): string {
    return join(this.configDir(configId), "templates")
  }

  private configDir(configId: string): string {
    return join(this.rootDir, ".shell-deck", "configs", assertValidPublicId(configId, "configId"))
  }

  private templatePath(configId: string, templateId: string): string {
    return join(this.templatesDir(configId), assertValidPublicId(templateId, "genericId") + ".json")
  }
}

function parseCurrentTemplate(value: unknown): MacroTemplate {
  return assertValidMacroTemplate(value)
}

function countNodes(nodes: unknown[]): number {
  let count = 0
  for (const node of nodes) {
    count += 1
    if (!isRecord(node)) continue
    if (node.type === "if") {
      if (Array.isArray(node.branches)) for (const branch of node.branches) if (isRecord(branch) && Array.isArray(branch.body)) count += countNodes(branch.body)
      if (Array.isArray(node.else)) count += countNodes(node.else)
    }
    if (node.type === "for" && Array.isArray(node.body)) count += countNodes(node.body)
    if ((node.type === "break" || node.type === "continue" || node.type === "finish") && Array.isArray(node.body)) count += countNodes(node.body)
  }
  return count
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

export function createTemplateId(): string {
  return "tmpl_" + translator.new()
}
