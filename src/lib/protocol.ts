import type { ContentEditLeaseView, ContentResourceKey } from './contentEditLease'
import type { MacroRunnerDelta, MacroRunnerSnapshot } from './macro/runnerTypes'
import type { RoomControlGrant, RoomControlView } from './roomControl'

export type TerminalBackendKind = 'fake' | 'real' | 'text'
export type TerminalStatus = 'starting' | 'running' | 'closed' | 'failed'
export type TerminalType = 'shell' | 'text'
export type TerminalReadiness = 'starting' | 'ready' | 'exited' | 'failed'

export type TerminalRuntimePosition = {
  index: number
  type: TerminalType
  terminalId: string
  launchId: string
  readiness: TerminalReadiness
  cwd?: string
}

export type TerminalRevisionFields = {
  roomRevision: number
  terminalRevision: number
  textRevision: number
  outputActivityRevision: number
}

export type TerminalSnapshot = TerminalRevisionFields & {
  type: 'terminal_snapshot'
  roomId: string
  roomGeneration: string
  terminalId: string
  launchId: string
  terminalIndex: number
  visualOrder: number
  status: TerminalStatus
  cols: number
  rows: number
  backend: TerminalBackendKind
  cwd: string | null
  replay: string[]
  exitCode: number | null
  signal: string | null
}

export type TerminalIndexMapItem = {
  index: number
  terminalId: string
}

export type RoomSnapshot = {
  type: 'room_snapshot'
  roomId: string
  roomGeneration: string
  roomRevision: number
  terminalStructureRevision: number
  terminals: TerminalSnapshot[]
  indexMap: TerminalIndexMapItem[]
  terminalPositions: TerminalRuntimePosition[]
  terminalStructureLocked: boolean
}

export type MacroNotificationLevel = 'info' | 'success' | 'warning' | 'error'
export type MacroNotificationSound = 'none' | 'bell' | 'chime' | 'ping' | 'pulse' | 'success' | 'warning' | 'alert'
export type MacroNotificationChannel =
  | { kind: 'app'; toast: boolean; sound: MacroNotificationSound }
  | { kind: 'system' }

export type MacroNotificationMessage = {
  type: 'macro_notification'
  roomId: string
  roomGeneration: string
  runId: string
  stepId: string
  notificationId: string
  createdAt: string
  level: MacroNotificationLevel
  title: string
  message: string
  channels: MacroNotificationChannel[]
}

export type ContentRecordChangedMessage = {
  type: 'content_record_changed'
  resourceKey: ContentResourceKey
  operation: 'saved' | 'deleted'
  revision: number | null
}

export type ServerMessage =
  | { type: 'client_registered'; clientId: string; roomId: string; roomGeneration: string; serverInstanceId: string }
  | { type: 'room_control'; roomId: string; roomGeneration: string; view: RoomControlView; grant?: RoomControlGrant }
  | { type: 'room_control_lost'; roomId: string; roomGeneration: string; controlEpoch: number }
  | { type: 'content_edit_lease_changed'; roomId: string; roomGeneration: string; resourceKey: ContentResourceKey; view: ContentEditLeaseView }
  | RoomSnapshot
  | TerminalSnapshot
  | { type: 'terminal_created'; roomId: string; roomGeneration: string; terminalId: string }
  | { type: 'terminal_index_map'; roomId: string; roomGeneration: string; roomRevision: number; terminalStructureRevision: number; items: TerminalIndexMapItem[]; terminalPositions: TerminalRuntimePosition[]; terminalStructureLocked: boolean }
  | (TerminalRevisionFields & { type: 'pty_output'; roomId: string; roomGeneration: string; terminalId: string; launchId: string; data: string; source: 'pty' })
  | (TerminalRevisionFields & { type: 'terminal_state'; roomId: string; roomGeneration: string; terminalId: string; launchId: string; status: TerminalStatus; cols: number; rows: number; exitCode: number | null; signal: string | null })
  | (TerminalRevisionFields & { type: 'terminal_cwd'; roomId: string; roomGeneration: string; terminalId: string; launchId: string; cwd: string })
  | { type: 'terminal_error'; roomId: string; roomGeneration: string; terminalId?: string; reason: string }
  | (TerminalRevisionFields & { type: 'terminal_replay'; roomId: string; roomGeneration: string; terminalId: string; launchId: string; replay: string[] })
  | { type: 'input_rejected'; roomId: string; roomGeneration: string; terminalId: string; reason: string }
  | { type: 'runner_snapshot'; snapshot: MacroRunnerSnapshot }
  | { type: 'runner_delta'; delta: MacroRunnerDelta }
  | ContentRecordChangedMessage
  | MacroNotificationMessage
  | { type: 'room_destroyed'; roomId: string; roomGeneration: string }

export type ClientMessage =
  | { type: 'create_terminal'; backend?: TerminalBackendKind; cols?: number; rows?: number; cwd?: string; cwdSource?: 'last-shell' }
  | { type: 'terminal_input'; terminalId?: string; terminalIndex?: number; data: string }
  | { type: 'set_terminal_text'; terminalId?: string; terminalIndex?: number; content: string }
  | { type: 'terminal_resize'; terminalId?: string; terminalIndex?: number; cols: number; rows: number }
  | { type: 'reorder_terminal'; terminalId: string; newIndex: number }
  | { type: 'close_terminal'; terminalId?: string; terminalIndex?: number }
  | { type: 'reset_terminal'; terminalId?: string; terminalIndex?: number; backend?: TerminalBackendKind }
  | { type: 'request_replay'; terminalId?: string; terminalIndex?: number }
  | { type: 'request_snapshot' }

export function parseClientMessage(raw: string | Buffer): ClientMessage {
  let value: unknown
  try { value = JSON.parse(raw.toString()) }
  catch { throw new Error('invalid_client_message_json') }
  if (!value || typeof value !== 'object' || Array.isArray(value) || typeof (value as { type?: unknown }).type !== 'string') throw new Error('invalid_client_message')
  const record = value as Record<string, unknown>
  const type = record.type
  const fields: Record<string, string[]> = {
    create_terminal: ['type', 'backend', 'cols', 'rows', 'cwd', 'cwdSource'],
    terminal_input: ['type', 'terminalId', 'terminalIndex', 'data'],
    set_terminal_text: ['type', 'terminalId', 'terminalIndex', 'content'],
    terminal_resize: ['type', 'terminalId', 'terminalIndex', 'cols', 'rows'],
    reorder_terminal: ['type', 'terminalId', 'newIndex'],
    close_terminal: ['type', 'terminalId', 'terminalIndex'],
    reset_terminal: ['type', 'terminalId', 'terminalIndex', 'backend'],
    request_replay: ['type', 'terminalId', 'terminalIndex'],
    request_snapshot: ['type'],
  }
  const allowed = typeof type === 'string' ? fields[type] : undefined
  if (!allowed) throw new Error('invalid_client_message_type')
  const unknown = Object.keys(record).find((key) => !allowed.includes(key))
  if (unknown) throw new Error('client_message_unknown_field:' + unknown)
  if (type !== 'create_terminal' && type !== 'request_snapshot' && type !== 'reorder_terminal') assertSingleTerminalRef(record)
  if ('backend' in record && record.backend !== undefined && record.backend !== 'fake' && record.backend !== 'real' && record.backend !== 'text') throw new Error('invalid_terminal_backend')
  if ('cwd' in record && record.cwd !== undefined && typeof record.cwd !== 'string') throw new Error('invalid_terminal_cwd')
  if ('cwdSource' in record && record.cwdSource !== undefined && record.cwdSource !== 'last-shell') throw new Error('invalid_terminal_cwd_source')
  if (type === 'create_terminal') {
    if (record.cwd !== undefined && record.cwdSource !== undefined) throw new Error('terminal_cwd_source_conflict')
    if (record.cols !== undefined && (!Number.isInteger(record.cols) || (record.cols as number) < 2)) throw new Error('invalid_terminal_size')
    if (record.rows !== undefined && (!Number.isInteger(record.rows) || (record.rows as number) < 2)) throw new Error('invalid_terminal_size')
  }
  if (type === 'terminal_input' && typeof record.data !== 'string') throw new Error('invalid_terminal_input')
  if (type === 'set_terminal_text' && typeof record.content !== 'string') throw new Error('invalid_terminal_text')
  if (type === 'terminal_resize' && (!Number.isInteger(record.cols) || !Number.isInteger(record.rows))) throw new Error('invalid_terminal_size')
  if (type === 'reorder_terminal' && (typeof record.terminalId !== 'string' || !Number.isInteger(record.newIndex))) throw new Error('invalid_terminal_reorder')
  return value as ClientMessage
}

function assertSingleTerminalRef(record: Record<string, unknown>): void {
  const refs = ['terminalId', 'terminalIndex'].filter((key) => record[key] !== undefined)
  if (refs.length !== 1) throw new Error('terminal_ref_must_have_exactly_one_selector')
  if (record.terminalId !== undefined && typeof record.terminalId !== 'string') throw new Error('invalid_terminal_id')
  if (record.terminalIndex !== undefined && (!Number.isInteger(record.terminalIndex) || (record.terminalIndex as number) < 1)) throw new Error('invalid_terminal_index')
}
