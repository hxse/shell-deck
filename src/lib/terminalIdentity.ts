import { assertGeneratedId, createGeneratedId } from './generatedId'

export type TerminalId = string & { readonly __terminalId: unique symbol }

export type TerminalRef =
  | { kind: 'id'; value: string }
  | { kind: 'index'; value: number }

export type TerminalIndexMapItem = {
  index: number
  terminalId: string
}

export function createTerminalId(): string {
  return createGeneratedId('terminal')
}

export function createTerminalLaunchId(): string {
  return createGeneratedId('terminalLaunch')
}

export function assertTerminalId(value: string): string {
  return assertGeneratedId(value, 'terminal')
}

export function normalizeTerminalRef(ref: string | number | TerminalRef): TerminalRef {
  if (typeof ref === 'number') {
    return { kind: 'index', value: ref }
  }
  if (typeof ref === 'string') {
    if (/^\d+$/.test(ref)) {
      return { kind: 'index', value: Number(ref) }
    }
    return { kind: 'id', value: assertTerminalId(ref) }
  }
  if (ref.kind === 'id') {
    return { kind: 'id', value: assertTerminalId(ref.value) }
  }
  if (!Number.isInteger(ref.value) || ref.value < 1) {
    throw new Error('invalid_terminalIndex:' + ref.value)
  }
  return ref
}

export function reindexTerminalOrder(terminalIds: string[]): TerminalIndexMapItem[] {
  return terminalIds.map((terminalId, offset) => ({ index: offset + 1, terminalId }))
}
