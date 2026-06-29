import shortUuid from 'short-uuid'
import { assertValidPublicId } from './identifier'

const translator = shortUuid()
const TERMINAL_ID_RE = /^term_[A-Za-z0-9_-]+$/

export type TerminalId = string & { readonly __terminalId: unique symbol }

export type TerminalRef =
  | { kind: 'id'; value: string }
  | { kind: 'index'; value: number }
  | { kind: 'alias'; value: string }

export type TerminalIndexMapItem = {
  index: number
  terminalId: string
  terminalAlias?: string
}

export function createTerminalId(): string {
  return 'term_' + translator.new()
}

export function createTerminalLaunchId(): string {
  return 'launch_' + translator.new()
}

export function assertTerminalId(value: string): string {
  assertValidPublicId(value, 'terminalId')
  if (!TERMINAL_ID_RE.test(value)) {
    throw new Error('invalid_terminalId:' + value)
  }
  return value
}

export function assertTerminalAlias(value: string): string {
  return assertValidPublicId(value, 'terminalAlias')
}

export function normalizeTerminalRef(ref: string | number | TerminalRef): TerminalRef {
  if (typeof ref === 'number') {
    return { kind: 'index', value: ref }
  }
  if (typeof ref === 'string') {
    if (/^\d+$/.test(ref)) {
      return { kind: 'index', value: Number(ref) }
    }
    if (TERMINAL_ID_RE.test(ref)) {
      return { kind: 'id', value: assertTerminalId(ref) }
    }
    return { kind: 'alias', value: assertTerminalAlias(ref) }
  }
  if (ref.kind === 'id') {
    return { kind: 'id', value: assertTerminalId(ref.value) }
  }
  if (ref.kind === 'alias') {
    return { kind: 'alias', value: assertTerminalAlias(ref.value) }
  }
  if (!Number.isInteger(ref.value) || ref.value < 1) {
    throw new Error('invalid_terminalIndex:' + ref.value)
  }
  return ref
}

export function reindexTerminalOrder(terminalIds: string[]): TerminalIndexMapItem[] {
  return terminalIds.map((terminalId, offset) => ({ index: offset + 1, terminalId }))
}
