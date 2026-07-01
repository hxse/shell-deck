import type { WorkspaceUiLayout } from './uiLayoutTypes'

export class UiLayoutClient {
  readonly configId: string

  constructor(configId: string) {
    this.configId = configId
  }

  async read(): Promise<WorkspaceUiLayout> {
    const response = await fetch('/api/configs/' + encodeURIComponent(this.configId) + '/ui-layout')
    if (!response.ok) throw new Error(await response.text())
    const body = await response.json() as { ok: boolean; layout: WorkspaceUiLayout; error?: string }
    if (!body.ok) throw new Error(body.error ?? 'layout_read_failed')
    return body.layout
  }

  async save(layout: WorkspaceUiLayout): Promise<WorkspaceUiLayout> {
    const response = await fetch('/api/configs/' + encodeURIComponent(this.configId) + '/ui-layout', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(layout),
    })
    const body = await response.json() as { ok: boolean; layout: WorkspaceUiLayout; error?: string }
    if (!response.ok || !body.ok) throw new Error(body.error ?? 'layout_save_failed')
    return body.layout
  }
}
