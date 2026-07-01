import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import shortUuid from 'short-uuid'
import { assertValidPublicId } from '../identifier'
import type { PromptRecord, PromptScope, PromptScopeFilter, PromptSummary } from './promptTypes'

const translator = shortUuid()

export class PromptStore {
  readonly rootDir: string

  constructor(rootDir = process.env.SHELL_DECK_DATA_ROOT ?? process.cwd()) {
    this.rootDir = rootDir
  }

  list(configId: string, options: { scope?: PromptScopeFilter; q?: string } = {}): PromptSummary[] {
    const normalizedConfigId = assertValidPublicId(configId, 'configId')
    const scope = options.scope ?? 'all'
    const prompts = [
      ...(scope === 'all' || scope === 'project' ? this.listRecords('project', normalizedConfigId) : []),
      ...(scope === 'all' || scope === 'global' ? this.listRecords('global', normalizedConfigId) : []),
    ]
    const query = (options.q ?? '').trim().toLowerCase()
    return prompts
      .filter((prompt) => !query || promptMatches(prompt, query))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map(promptSummary)
  }

  read(scope: PromptScope, configId: string, promptId: string): PromptRecord {
    const path = this.promptPath(scope, configId, promptId)
    if (!existsSync(path)) throw new Error('prompt_not_found:' + promptId)
    return normalizePrompt(JSON.parse(readFileSync(path, 'utf8')), scope, configId)
  }

  create(scope: PromptScope, configId: string, input: unknown): PromptRecord {
    const body = asRecord(input)
    const now = new Date().toISOString()
    const promptId = typeof body.promptId === 'string' && body.promptId.trim()
      ? assertValidPublicId(body.promptId.trim(), 'genericId')
      : createPromptId()
    if (existsSync(this.promptPath(scope, configId, promptId))) throw new Error('prompt_id_conflict:' + promptId)
    return this.save(scope, configId, promptId, {
      schemaVersion: 1,
      promptId,
      scope,
      configId: scope === 'project' ? assertValidPublicId(configId, 'configId') : undefined,
      title: stringValue(body.title, 'title').trim(),
      body: typeof body.body === 'string' ? body.body : '',
      tags: normalizeTags(body.tags),
      description: typeof body.description === 'string' ? body.description : undefined,
      createdAt: now,
      updatedAt: now,
    })
  }

  update(scope: PromptScope, configId: string, promptId: string, input: unknown): PromptRecord {
    const existing = this.read(scope, configId, promptId)
    const body = asRecord(input)
    const targetScope = parsePromptScope(body.scope, scope)
    const targetConfigId = targetScope === 'project' ? assertValidPublicId(configId, 'configId') : configId
    const next: PromptRecord = {
      ...existing,
      scope: targetScope,
      configId: targetScope === 'project' ? targetConfigId : undefined,
      title: body.title === undefined ? existing.title : stringValue(body.title, 'title').trim(),
      body: body.body === undefined ? existing.body : String(body.body),
      tags: body.tags === undefined ? existing.tags : normalizeTags(body.tags),
      description: body.description === undefined ? existing.description : typeof body.description === 'string' ? body.description : undefined,
      updatedAt: new Date().toISOString(),
    }
    if (targetScope === scope) return this.save(scope, configId, promptId, next)
    if (existsSync(this.promptPath(targetScope, configId, promptId))) throw new Error('prompt_id_conflict:' + promptId)
    const saved = this.save(targetScope, configId, promptId, next)
    this.delete(scope, configId, promptId)
    return saved
  }

  delete(scope: PromptScope, configId: string, promptId: string): void {
    const path = this.promptPath(scope, configId, promptId)
    if (existsSync(path)) unlinkSync(path)
  }

  private save(scope: PromptScope, configId: string, promptId: string, prompt: PromptRecord): PromptRecord {
    const normalized = normalizePrompt(prompt, scope, configId)
    if (normalized.promptId !== assertValidPublicId(promptId, 'genericId')) throw new Error('prompt_id_mismatch')
    const dir = this.promptDir(scope, configId)
    mkdirSync(dir, { recursive: true })
    const path = this.promptPath(scope, configId, promptId)
    const tmpPath = path + '.tmp'
    writeFileSync(tmpPath, JSON.stringify(normalized, null, 2) + '\n')
    renameSync(tmpPath, path)
    return normalized
  }

  private listRecords(scope: PromptScope, configId: string): PromptRecord[] {
    const dir = this.promptDir(scope, configId)
    if (!existsSync(dir)) return []
    return readdirSync(dir)
      .filter((fileName) => fileName.endsWith('.json'))
      .map((fileName) => this.read(scope, configId, fileName.slice(0, -'.json'.length)))
  }

  private promptDir(scope: PromptScope, configId: string): string {
    if (scope === 'global') return join(this.rootDir, '.shell-deck', 'prompts', 'global')
    return join(this.rootDir, '.shell-deck', 'configs', assertValidPublicId(configId, 'configId'), 'prompts')
  }

  private promptPath(scope: PromptScope, configId: string, promptId: string): string {
    return join(this.promptDir(scope, configId), assertValidPublicId(promptId, 'genericId') + '.json')
  }
}

function parsePromptScope(value: unknown, fallback: PromptScope): PromptScope {
  if (value === undefined) return fallback
  if (value === 'project' || value === 'global') return value
  throw new Error('invalid_prompt_scope')
}

function normalizePrompt(value: unknown, scope: PromptScope, configId: string): PromptRecord {
  const source = asRecord(value)
  const promptId = assertValidPublicId(stringValue(source.promptId, 'promptId'), 'genericId')
  const title = stringValue(source.title, 'title').trim()
  if (!title) throw new Error('prompt_title_required')
  const createdAt = stringValue(source.createdAt, 'createdAt')
  const updatedAt = stringValue(source.updatedAt, 'updatedAt')
  if (Number.isNaN(Date.parse(createdAt))) throw new Error('prompt_createdAt_invalid')
  if (Number.isNaN(Date.parse(updatedAt))) throw new Error('prompt_updatedAt_invalid')
  return {
    schemaVersion: 1,
    promptId,
    scope,
    configId: scope === 'project' ? assertValidPublicId(configId, 'configId') : undefined,
    title,
    body: typeof source.body === 'string' ? source.body : '',
    tags: normalizeTags(source.tags),
    description: typeof source.description === 'string' ? source.description : undefined,
    createdAt,
    updatedAt,
  }
}

function promptSummary(prompt: PromptRecord): PromptSummary {
  return {
    promptId: prompt.promptId,
    scope: prompt.scope,
    configId: prompt.configId,
    title: prompt.title,
    tags: prompt.tags,
    updatedAt: prompt.updatedAt,
    bodyPreview: prompt.body.slice(0, 160),
  }
}

function promptMatches(prompt: PromptRecord, query: string): boolean {
  return prompt.title.toLowerCase().includes(query)
    || prompt.body.toLowerCase().includes(query)
    || (prompt.tags ?? []).some((tag) => tag.toLowerCase().includes(query))
}

function normalizeTags(value: unknown): string[] {
  if (typeof value === 'string') return value.split(',').map((tag) => tag.trim()).filter(Boolean)
  if (!Array.isArray(value)) return []
  return value.map((tag) => String(tag).trim()).filter(Boolean)
}

function stringValue(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error('prompt_' + field + '_required')
  return value
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('prompt_record_must_be_object')
  return value as Record<string, unknown>
}

function createPromptId(): string {
  return 'prompt_' + translator.new().replace(/[^A-Za-z0-9_-]/g, '').slice(0, 18)
}
