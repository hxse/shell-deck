import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import shortUuid from 'short-uuid'
import { assertValidPublicId } from '../identifier'
import type { TerminalIndexMapItem } from '../protocol'
import { assertValidMacroTemplate, validateMacroTemplate } from './templateSchema'
import type { CaptureSourceConfig, MacroTemplate, MacroStep, TemplateSummary, TerminalTarget, ValidationResult } from './templateTypes'

const translator = shortUuid()

export class MacroTemplateStore {
  readonly rootDir: string

  constructor(rootDir = process.env.SHELL_DECK_DATA_ROOT ?? process.cwd()) {
    this.rootDir = rootDir
  }

  list(configId: string): TemplateSummary[] {
    const dir = this.templatesDir(configId)
    if (!existsSync(dir)) return []
    return readdirSync(dir)
      .filter((fileName) => fileName.endsWith('.json'))
      .map((fileName) => this.read(configId, fileName.slice(0, -'.json'.length)))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((template) => ({
        id: template.id,
        name: template.name,
        description: template.description,
        updatedAt: template.updatedAt,
        stepCount: template.steps.length,
      }))
  }

  read(configId: string, templateId: string): MacroTemplate {
    const path = this.templatePath(configId, templateId)
    if (!existsSync(path)) {
      throw new Error('template_not_found:' + templateId)
    }
    return migrateLegacyMacroTemplate(JSON.parse(readFileSync(path, 'utf8')))
  }

  create(configId: string, indexMap: TerminalIndexMapItem[] = []): MacroTemplate {
    const now = new Date().toISOString()
    const template: MacroTemplate = {
      schemaVersion: 1,
      id: createTemplateId(),
      name: 'New Macro Template',
      description: '',
      configId: assertValidPublicId(configId, 'configId'),
      steps: [],
      createdAt: now,
      updatedAt: now,
    }
    return this.save(configId, template, indexMap)
  }

  save(configId: string, template: MacroTemplate, indexMap: TerminalIndexMapItem[] = []): MacroTemplate {
    const normalizedConfigId = assertValidPublicId(configId, 'configId')
    if (template.configId !== normalizedConfigId) {
      throw new Error('template_config_mismatch:' + template.configId + ':' + normalizedConfigId)
    }
    const next = {
      ...template,
      id: assertValidPublicId(template.id, 'genericId'),
      configId: normalizedConfigId,
      updatedAt: new Date().toISOString(),
    }
    assertValidMacroTemplate(next, { indexMap })
    mkdirSync(this.templatesDir(normalizedConfigId), { recursive: true })
    const path = this.templatePath(normalizedConfigId, next.id)
    const tmpPath = path + '.tmp'
    writeFileSync(tmpPath, JSON.stringify(next, null, 2) + '\n')
    renameSync(tmpPath, path)
    return next
  }

  duplicate(configId: string, templateId: string, indexMap: TerminalIndexMapItem[] = []): MacroTemplate {
    const source = this.read(configId, templateId)
    const now = new Date().toISOString()
    const copy: MacroTemplate = {
      ...source,
      id: createTemplateId(),
      name: source.name + ' Copy',
      createdAt: now,
      updatedAt: now,
    }
    return this.save(configId, copy, indexMap)
  }

  delete(configId: string, templateId: string): void {
    const path = this.templatePath(configId, templateId)
    if (existsSync(path)) {
      unlinkSync(path)
    }
  }

  import(configId: string, value: unknown, indexMap: TerminalIndexMapItem[] = []): MacroTemplate {
    if (!value || typeof value !== 'object') {
      throw new Error('import_template_must_be_object')
    }
    const now = new Date().toISOString()
    const incoming = migrateLegacyMacroTemplate(value)
    const candidateId = typeof incoming.id === 'string' ? incoming.id : createTemplateId()
    const id = existsSync(this.templatePath(configId, candidateId)) ? createTemplateId() : candidateId
    const template: MacroTemplate = {
      ...incoming,
      id,
      configId: assertValidPublicId(configId, 'configId'),
      createdAt: typeof incoming.createdAt === 'string' ? incoming.createdAt : now,
      updatedAt: now,
    }
    return this.save(configId, template, indexMap)
  }

  validate(template: unknown, indexMap: TerminalIndexMapItem[] = []): ValidationResult {
    return validateMacroTemplate(template, { indexMap })
  }

  private templatesDir(configId: string): string {
    return join(this.configDir(configId), 'templates')
  }

  private configDir(configId: string): string {
    return join(this.rootDir, '.shell-deck', 'configs', assertValidPublicId(configId, 'configId'))
  }

  private templatePath(configId: string, templateId: string): string {
    return join(this.templatesDir(configId), assertValidPublicId(templateId, 'genericId') + '.json')
  }
}


function migrateLegacyMacroTemplate(value: unknown): MacroTemplate {
  if (!isRecord(value)) return value as MacroTemplate
  const source = value as Record<string, unknown>
  const terminalAliases = isRecord(source.terminalAliases) ? source.terminalAliases : {}
  const captureSources = isRecord(source.captureSources) ? source.captureSources : {}
  const steps = Array.isArray(source.steps) ? source.steps.map((step) => migrateLegacyStep(step, terminalAliases)) : source.steps

  if (Array.isArray(steps)) {
    const sourceToCaptureStep = new Map<string, string>()
    const usedStepIds = new Set<string>()

    for (const step of steps) {
      if (!isRecord(step)) continue
      if (typeof step.id === 'string') usedStepIds.add(step.id)
      if (step.type === 'capture-source' && typeof step.source === 'string' && typeof step.id === 'string') {
        sourceToCaptureStep.set(step.source, step.id)
      }
    }

    for (const step of steps) {
      if (!isRecord(step)) continue
      if (step.type !== 'capture-source') continue
      const sourceId = typeof step.source === 'string' ? step.source : undefined
      if (!isRecord(step.capture)) {
        step.capture = migrateLegacyCaptureConfig(sourceId ? captureSources[sourceId] : undefined, terminalAliases)
      } else {
        step.capture = migrateLegacyCaptureConfig(step.capture, terminalAliases)
      }
      delete step.source
    }

    for (const step of steps) {
      if (!isRecord(step)) continue
      const sourceId = typeof step.source === 'string' ? step.source : undefined
      if (!sourceId || sourceToCaptureStep.has(sourceId) || !isRecord(captureSources[sourceId])) continue
      const captureStepId = uniqueMigratedStepId('capture_' + sourceId, usedStepIds)
      usedStepIds.add(captureStepId)
      sourceToCaptureStep.set(sourceId, captureStepId)
      steps.push({
        id: captureStepId,
        type: 'capture-source',
        capture: migrateLegacyCaptureConfig(captureSources[sourceId], terminalAliases),
      } satisfies Extract<MacroStep, { type: 'capture-source' }>)
    }

    for (const step of steps) {
      if (!isRecord(step)) continue
      const sourceId = typeof step.source === 'string' ? step.source : undefined
      if (sourceId && (step.type === 'parse' || (step.type === 'wait' && step.mode === 'capture-ready-or-user'))) {
        step.captureStep = sourceToCaptureStep.get(sourceId) ?? sourceId
        delete step.source
      }
    }
  }

  const migrated = { ...source, steps } as Record<string, unknown>
  delete migrated.terminalAliases
  delete migrated.captureSources
  return migrated as MacroTemplate
}

function migrateLegacyStep(step: unknown, terminalAliases: Record<string, unknown>): unknown {
  if (!isRecord(step)) return step
  const migrated = { ...step }
  if (migrated.type === 'send_line' || migrated.type === 'input_line') {
    migrated.terminal = migrateLegacyTerminalTarget(migrated.terminal, terminalAliases)
  }
  if (migrated.type === 'wait' && migrated.mode === 'terminal-quiet') {
    migrated.terminal = migrateLegacyTerminalTarget(migrated.terminal, terminalAliases)
  }
  return migrated
}

function migrateLegacyCaptureConfig(value: unknown, terminalAliases: Record<string, unknown>): CaptureSourceConfig {
  const source = isRecord(value) ? value : {}
  if (source.kind === 'agent-event') {
    return {
      kind: 'agent-event',
      agentKind: 'codex',
      eventKind: 'agent.output',
      adapter: 'codex-stop-hook',
      terminal: migrateLegacyTerminalTarget(source.terminal, terminalAliases),
    }
  }
  return {
    kind: 'terminal-buffer',
    terminal: migrateLegacyTerminalTarget(source.terminal, terminalAliases),
    mode: 'scrollback-tail',
    maxChars: Number.isInteger(source.maxChars) && Number(source.maxChars) > 0 ? Number(source.maxChars) : 20000,
  }
}

function migrateLegacyTerminalTarget(value: unknown, terminalAliases: Record<string, unknown>, seenAliases = new Set<string>()): TerminalTarget {
  if (isRecord(value)) {
    if (value.kind === 'index' && Number.isInteger(value.value)) return { kind: 'index', value: Number(value.value) }
    if (value.kind === 'id' && typeof value.value === 'string') return { kind: 'id', value: value.value }
    if (value.kind === 'alias' && typeof value.value === 'string') return { kind: 'alias', value: value.value }
  }
  if (Number.isInteger(value)) return { kind: 'index', value: Number(value) }
  if (typeof value === 'string' && value.length > 0) {
    if (Object.prototype.hasOwnProperty.call(terminalAliases, value) && !seenAliases.has(value)) {
      seenAliases.add(value)
      return migrateLegacyTerminalTarget(terminalAliases[value], terminalAliases, seenAliases)
    }
    return { kind: 'alias', value }
  }
  return { kind: 'index', value: 1 }
}

function uniqueMigratedStepId(rawBase: string, used: Set<string>): string {
  const sanitized = rawBase.replace(/[^A-Za-z0-9_-]/g, '_').replace(/^[^A-Za-z0-9]+/, '') || 'capture_source'
  const base = sanitized.slice(0, 48) || 'capture_source'
  let candidate = base
  for (let index = 2; used.has(candidate) && index < 1000; index += 1) {
    candidate = (base + '_' + index).slice(0, 64)
  }
  return candidate
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function createTemplateId(): string {
  return 'tmpl_' + translator.new()
}
