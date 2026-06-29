import type { ProfileCatalogSummary } from './profileCatalogSummary'
import type { MacroTemplate, TemplateSummary, ValidationIssue } from './templateTypes'

type ListResponse = { ok: true; templates: TemplateSummary[] }
type TemplateResponse = { ok: true; template: MacroTemplate }
type ErrorResponse = { ok: false; error?: string; issues?: ValidationIssue[] }

export class MacroTemplateClient {
  readonly configId: string

  constructor(configId: string) {
    this.configId = configId
  }

  async profileCatalog(): Promise<ProfileCatalogSummary> {
    return await jsonFetch('/api/macro/profile-catalog')
  }

  async list(): Promise<TemplateSummary[]> {
    const response = await jsonFetch<ListResponse>(this.basePath())
    return response.templates
  }

  async create(): Promise<MacroTemplate> {
    const response = await jsonFetch<TemplateResponse>(this.basePath(), { method: 'POST' })
    return response.template
  }

  async read(templateId: string): Promise<MacroTemplate> {
    const response = await jsonFetch<TemplateResponse>(this.templatePath(templateId))
    return response.template
  }

  async save(template: MacroTemplate): Promise<MacroTemplate> {
    const response = await jsonFetch<TemplateResponse>(this.templatePath(template.id), {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(template),
    })
    return response.template
  }

  async duplicate(templateId: string): Promise<MacroTemplate> {
    const response = await jsonFetch<TemplateResponse>(this.templatePath(templateId) + '/duplicate', { method: 'POST' })
    return response.template
  }

  async delete(templateId: string): Promise<void> {
    await jsonFetch<{ ok: true }>(this.templatePath(templateId), { method: 'DELETE' })
  }

  async importTemplate(template: unknown): Promise<MacroTemplate> {
    const response = await jsonFetch<TemplateResponse>(this.basePath() + '/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(template),
    })
    return response.template
  }

  async exportTemplate(templateId: string): Promise<MacroTemplate> {
    return await jsonFetch<MacroTemplate>(this.templatePath(templateId) + '/export')
  }

  private basePath(): string {
    return '/api/configs/' + encodeURIComponent(this.configId) + '/templates'
  }

  private templatePath(templateId: string): string {
    return this.basePath() + '/' + encodeURIComponent(templateId)
  }
}

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  const body = await response.json() as T | ErrorResponse
  if (!response.ok) {
    const error = body as ErrorResponse
    const details = error.issues?.map((issue) => issue.path + ': ' + issue.message).join('\\n')
    throw new Error(details || error.error || 'request_failed:' + response.status)
  }
  return body as T
}
