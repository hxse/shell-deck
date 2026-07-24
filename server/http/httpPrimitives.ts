import { assertGeneratedId } from '../../src/lib/generatedId'
import {
  ROOM_CONTROL_CLIENT_HEADER,
  ROOM_CONTROL_EPOCH_HEADER,
  ROOM_CONTROL_LEASE_HEADER,
  type RoomControlBearer,
} from '../../src/lib/roomControl'
import { MacroNotRunnableError } from '../macroRunnerService'

export function errorResponse(error: unknown, api: boolean): Response {
  if (api && error instanceof MacroNotRunnableError) return json({ ok: false, error: error.message, issues: error.issues }, 400)
  const message = errorMessage(error)
  const status = errorStatus(message)
  return api ? json({ ok: false, error: message }, status) : notFoundPage(message)
}

function errorStatus(message: string): number {
  if (message === 'room_not_found' || message === 'route_not_found') return 404
  if (
    message === 'room_capacity_reached'
    || message === 'room_destroying'
    || message === 'room_generation_conflict'
    || message.startsWith('room_control_')
    || message.startsWith('content_edit_')
    || message === 'content_revision_conflict'
    || message === 'terminal_structure_revision_conflict'
    || message === 'room_structure_locked_by_run'
    || message === 'macro_revision_conflict'
    || message === 'run_already_active'
    || message.startsWith('runner_input_')
    || message === 'runner_not_waiting_input'
  ) return 409
  if (message.startsWith('macro_record_not_found:')) return 404
  if (message.includes('permissions_too_open')) return 503
  return 400
}

export function assertPositiveRevision(value: unknown, error = 'invalid_macro_revision'): number {
  if (!Number.isInteger(value) || (value as number) < 1) throw new Error(error)
  return value as number
}

export function assertTerminalStructureRevision(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 0) throw new Error('invalid_terminal_structure_revision')
  return value as number
}

export function assertNonNegativeRevision(value: unknown, error: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) throw new Error(error)
  return value as number
}

export function parseIfMatch(req: Request, error = 'invalid_macro_revision'): number {
  const value = req.headers.get('if-match')
  if (!value || !/^[1-9][0-9]*$/.test(value)) throw new Error(error)
  return Number(value)
}

export function exactQuery(url: URL, allowed: string[], required: string[] = []): URLSearchParams {
  for (const key of url.searchParams.keys()) {
    if (!allowed.includes(key)) throw new Error('query_unknown_field:' + key)
    if (url.searchParams.getAll(key).length !== 1) throw new Error('query_duplicate_field:' + key)
  }
  for (const key of required) if (!url.searchParams.has(key)) throw new Error('query_missing_field:' + key)
  return url.searchParams
}

export function contentEditLeaseHeader(req: Request): string {
  const value = req.headers.get('x-shell-deck-content-edit-lease')
  if (!value) throw new Error('content_edit_lease_required')
  return assertGeneratedId(value, 'contentEditLease')
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } })
}

export function methodNotAllowed(allow: string[]): Response {
  return new Response('method_not_allowed', { status: 405, headers: { allow: allow.join(', ') } })
}

export async function requestJson(req: Request): Promise<unknown> {
  const text = await req.text()
  if (!text) throw new Error('request_body_required')
  try { return JSON.parse(text) }
  catch { throw new Error('invalid_request_json') }
}

export async function exactObject(req: Request, keys: string[]): Promise<Record<string, unknown>> {
  const value = await requestJson(req)
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('request_body_must_be_object')
  const record = value as Record<string, unknown>
  const unknown = Object.keys(record).find((key) => !keys.includes(key))
  if (unknown) throw new Error('request_unknown_field:' + unknown)
  const missing = keys.find((key) => !Object.prototype.hasOwnProperty.call(record, key))
  if (missing) throw new Error('request_missing_field:' + missing)
  return record
}

export function roomControlClientId(req: Request): string {
  const value = req.headers.get(ROOM_CONTROL_CLIENT_HEADER)
  if (!value) throw new Error('room_control_required')
  try { return assertGeneratedId(value, 'client') }
  catch { throw new Error('room_control_required') }
}

export function roomControlBearer(req: Request): RoomControlBearer {
  const clientId = req.headers.get(ROOM_CONTROL_CLIENT_HEADER)
  const controlLeaseId = req.headers.get(ROOM_CONTROL_LEASE_HEADER)
  const epochText = req.headers.get(ROOM_CONTROL_EPOCH_HEADER)
  if (!clientId || !controlLeaseId || !epochText) throw new Error('room_control_required')
  if (!/^(0|[1-9][0-9]*)$/.test(epochText)) throw new Error('room_control_lost')
  try {
    return {
      clientId: assertGeneratedId(clientId, 'client'),
      controlLeaseId: assertGeneratedId(controlLeaseId, 'roomControlLease'),
      controlEpoch: Number(epochText),
    }
  } catch {
    throw new Error('room_control_lost')
  }
}

export function assertNoQuery(url: URL): void {
  if ([...url.searchParams].length > 0) throw new Error('query_not_supported')
}

export function notFoundPage(error: string): Response {
  return new Response('<!doctype html><meta charset="utf-8"><title>shell-deck</title><p>' + escapeHtml(error) + '</p><a href="/">Home</a>', {
    status: error === 'room_capacity_reached' ? 409 : 404,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  })
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}
