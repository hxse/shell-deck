export type WorkspacePanelKey = 'macro' | 'prompt'

export type WorkspacePanelLayout = {
  visible: boolean
  widthPx: number
}

export type WorkspaceUiLayout = {
  schemaVersion: 1
  panels: Record<WorkspacePanelKey, WorkspacePanelLayout>
}

export const DEFAULT_WORKSPACE_LAYOUT: WorkspaceUiLayout = {
  schemaVersion: 1,
  panels: {
    macro: { visible: true, widthPx: 760 },
    prompt: { visible: false, widthPx: 360 },
  },
}

export const PANEL_MIN_WIDTH_PX = 280
export const PANEL_DEFAULT_WIDTH: Record<WorkspacePanelKey, number> = {
  macro: DEFAULT_WORKSPACE_LAYOUT.panels.macro.widthPx,
  prompt: DEFAULT_WORKSPACE_LAYOUT.panels.prompt.widthPx,
}

export function normalizeWorkspaceUiLayout(value: unknown): WorkspaceUiLayout {
  const source = isRecord(value) ? value : {}
  const panels = isRecord(source.panels) ? source.panels : {}
  return {
    schemaVersion: 1,
    panels: {
      macro: normalizePanelLayout(panels.macro, DEFAULT_WORKSPACE_LAYOUT.panels.macro),
      prompt: normalizePanelLayout(panels.prompt, DEFAULT_WORKSPACE_LAYOUT.panels.prompt),
    },
  }
}

export function normalizePanelWidth(value: unknown, fallback: number): number {
  const width = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(width)) return fallback
  return Math.max(PANEL_MIN_WIDTH_PX, Math.min(900, Math.round(width)))
}

function normalizePanelLayout(value: unknown, fallback: WorkspacePanelLayout): WorkspacePanelLayout {
  const source = isRecord(value) ? value : {}
  return {
    visible: typeof source.visible === 'boolean' ? source.visible : fallback.visible,
    widthPx: normalizePanelWidth(source.widthPx, fallback.widthPx),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
