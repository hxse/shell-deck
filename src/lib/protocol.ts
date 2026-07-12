import type { RunEventKind } from './runLog/runEventTypes'
import type { WorkspaceUiLayout } from './workspace/uiLayoutTypes'
export type TerminalBackendKind = 'fake' | 'real' | 'text'
export type TerminalStatus = 'starting' | 'running' | 'closed' | 'failed'

export type TerminalSnapshot = {
  type: 'terminal_snapshot'
  configId: string
  terminalId: string
  launchId: string
  terminalAlias: string
  terminalIndex: number
  visualOrder: number
  status: TerminalStatus
  cols: number
  rows: number
  backend: TerminalBackendKind
  replay: string[]
  exitCode: number | null
  signal: string | null
}

export type TerminalIndexMapItem = {
  index: number
  terminalId: string
  terminalAlias: string
}

export type DeckSnapshot = {
  type: 'deck_snapshot'
  configId: string
  terminals: TerminalSnapshot[]
  indexMap: TerminalIndexMapItem[]
}

export type PromptUpdatedMessage = {
  type: 'prompts_updated'
  configId: string
  scope: 'project' | 'global'
  action: 'created' | 'updated' | 'deleted' | 'moved'
  promptId: string
  oldScope?: 'project' | 'global'
  newScope?: 'project' | 'global'
}

export type RunLogUpdatedMessage = {
  type: 'run_log_updated'
  configId: string
  runId: string
  eventSeq: number
  kind: RunEventKind
}

export type MacroNotificationLevel = 'info' | 'success' | 'warning' | 'error'
export type MacroNotificationSound = 'none' | 'bell' | 'chime' | 'ping' | 'pulse' | 'success' | 'warning' | 'alert'
export type MacroNotificationChannel =
  | { kind: 'app'; toast: boolean; sound: MacroNotificationSound }
  | { kind: 'system' }

export type MacroNotificationMessage = {
  type: 'macro_notification'
  configId: string
  runId: string
  stepId: string
  notificationId: string
  createdAt: string
  level: MacroNotificationLevel
  title: string
  message: string
  channels: MacroNotificationChannel[]
}

export type ServerMessage =
  | { type: 'client_registered'; clientId: string; configId: string }
  | DeckSnapshot
  | TerminalSnapshot
  | { type: 'terminal_index_map'; configId: string; items: TerminalIndexMapItem[] }
  | { type: 'pty_output'; configId: string; terminalId: string; data: string; source: 'pty' }
  | { type: 'terminal_state'; configId: string; terminalId: string; status: TerminalStatus; cols: number; rows: number; exitCode: number | null; signal: string | null }
  | { type: 'terminal_error'; configId: string; terminalId?: string; reason: string }
  | { type: 'terminal_replay'; configId: string; terminalId: string; replay: string[] }
  | { type: 'input_rejected'; configId: string; terminalId: string; reason: string }
  | { type: 'ui_layout_updated'; configId: string; layout: WorkspaceUiLayout }
  | PromptUpdatedMessage
  | RunLogUpdatedMessage
  | MacroNotificationMessage

export type ClientMessage =
  | { type: 'create_terminal'; backend?: TerminalBackendKind; cols?: number; rows?: number }
  | { type: 'terminal_input'; terminalId?: string; terminalIndex?: number; terminalAlias?: string; data: string }
  | { type: 'set_terminal_text'; terminalId?: string; terminalIndex?: number; terminalAlias?: string; content: string }
  | { type: 'terminal_resize'; terminalId?: string; terminalIndex?: number; terminalAlias?: string; cols: number; rows: number }
  | { type: 'rename_terminal'; terminalId: string; terminalAlias: string }
  | { type: 'reorder_terminal'; terminalId: string; newIndex: number }
  | { type: 'close_terminal'; terminalId?: string; terminalIndex?: number; terminalAlias?: string }
  | { type: 'reset_terminal'; terminalId?: string; terminalIndex?: number; terminalAlias?: string; backend?: TerminalBackendKind }
  | { type: 'request_replay'; terminalId?: string; terminalIndex?: number; terminalAlias?: string }
  | { type: 'request_snapshot' }

export function parseClientMessage(raw: string | Buffer): ClientMessage {
  const value = JSON.parse(raw.toString()) as ClientMessage
  if (!value || typeof value !== 'object' || typeof value.type !== 'string') {
    throw new Error('invalid_client_message')
  }
  return value
}
