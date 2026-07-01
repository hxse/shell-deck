import type { PromptRecord, PromptScope, PromptScopeFilter, PromptSummary } from './promptTypes'

export class PromptClient {
  readonly configId: string

  constructor(configId: string) {
    this.configId = configId
  }

  async list(scope: PromptScopeFilter, q: string): Promise<PromptSummary[]> {
    const params = new URLSearchParams({ scope, q })
    const response = await fetch('/api/configs/' + encodeURIComponent(this.configId) + '/prompts?' + params.toString())
    const body = await response.json() as { ok: boolean; prompts: PromptSummary[]; error?: string }
    if (!response.ok || !body.ok) throw new Error(body.error ?? 'prompt_list_failed')
    return body.prompts
  }

  async read(scope: PromptScope, promptId: string): Promise<PromptRecord> {
    const response = await fetch(this.promptUrl(scope, promptId))
    const body = await response.json() as { ok: boolean; prompt: PromptRecord; error?: string }
    if (!response.ok || !body.ok) throw new Error(body.error ?? 'prompt_read_failed')
    return body.prompt
  }

  async create(scope: PromptScope, input: Partial<PromptRecord>): Promise<PromptRecord> {
    const response = await fetch(scope === 'global' ? '/api/prompts/global?configId=' + encodeURIComponent(this.configId) : '/api/configs/' + encodeURIComponent(this.configId) + '/prompts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    })
    const body = await response.json() as { ok: boolean; prompt: PromptRecord; error?: string }
    if (!response.ok || !body.ok) throw new Error(body.error ?? 'prompt_create_failed')
    return body.prompt
  }

  async save(prompt: PromptRecord, currentScope: PromptScope = prompt.scope): Promise<PromptRecord> {
    const response = await fetch(this.promptUrl(currentScope, prompt.promptId), {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(prompt),
    })
    const body = await response.json() as { ok: boolean; prompt: PromptRecord; error?: string }
    if (!response.ok || !body.ok) throw new Error(body.error ?? 'prompt_save_failed')
    return body.prompt
  }

  async delete(scope: PromptScope, promptId: string): Promise<void> {
    const response = await fetch(this.promptUrl(scope, promptId), { method: 'DELETE' })
    if (!response.ok) throw new Error(await response.text())
  }

  private promptUrl(scope: PromptScope, promptId: string): string {
    if (scope === 'global') return '/api/prompts/global/' + encodeURIComponent(promptId) + '?configId=' + encodeURIComponent(this.configId)
    return '/api/configs/' + encodeURIComponent(this.configId) + '/prompts/' + encodeURIComponent(promptId)
  }
}
