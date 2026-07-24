import { isJsonValue, type JsonValue } from '../src/lib/macro/structuredJson'
import type { MacroRunnerService } from './macroRunnerService'
import type { TerminalRoomManager } from './terminalRoomManager'

export type StructuredJsonIngestOptions = {
  roomId: string
  expectedToken: string
  manager: TerminalRoomManager
  macroRunner: MacroRunnerService
}

export type StructuredJsonIngestResult =
  | { ok: true }
  | { ok: false; status: number; error: string; issues?: unknown[] }

export function ingestStructuredJson(
  input: unknown,
  token: string | undefined,
  options: StructuredJsonIngestOptions,
): StructuredJsonIngestResult {
  if (!token || token !== options.expectedToken) {
    return { ok: false, status: 403, error: 'structured_json_ingest_token_invalid' }
  }
  const body = parseStructuredJsonSubmission(input)
  if (!body) return { ok: false, status: 422, error: 'structured_json_submission_invalid' }

  let ticket
  try {
    ticket = options.manager.admit(options.roomId)
    ticket.assertActive()
    if (!options.manager.hasTerminalLaunch(
      options.roomId,
      body.roomGeneration,
      body.terminalId,
      body.launchId,
    )) {
      return { ok: false, status: 404, error: 'structured_json_runtime_membership_mismatch' }
    }
    ticket.assertActive()
    const result = options.macroRunner.submitStructuredJson(options.roomId, body)
    if (result.ok) return { ok: true }
    if (result.kind === 'schema_mismatch') {
      return {
        ok: false,
        status: 422,
        error: 'structured_json_schema_mismatch',
        issues: result.issues,
      }
    }
    return { ok: false, status: 409, error: 'structured_json_capture_not_waiting' }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message === 'room_not_found' || message === 'room_destroying') {
      return {
        ok: false,
        status: 404,
        error: 'structured_json_runtime_membership_mismatch',
      }
    }
    return {
      ok: false,
      status: 422,
      error: message,
    }
  } finally {
    ticket?.finish()
  }
}

export function parseStructuredJsonSubmission(input: unknown): {
  roomGeneration: string
  terminalId: string
  launchId: string
  value: JsonValue
} | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const body = input as Record<string, unknown>
  const keys = Object.keys(body)
  const expected = ['protocolVersion', 'roomGeneration', 'terminalId', 'launchId', 'value']
  if (keys.length !== expected.length || keys.some((key) => !expected.includes(key))) return null
  if (body.protocolVersion !== 1) return null
  if (
    typeof body.roomGeneration !== 'string'
    || typeof body.terminalId !== 'string'
    || typeof body.launchId !== 'string'
    || !isJsonValue(body.value)
  ) return null
  return {
    roomGeneration: body.roomGeneration,
    terminalId: body.terminalId,
    launchId: body.launchId,
    value: body.value,
  }
}
