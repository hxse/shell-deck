import type { TerminalBackendKind, TerminalStatus } from '../src/lib/protocol'
import type { TerminalBackend } from './terminalBackend'
import { advanceTerminalOutputActivity, createTerminalReplayFields, type TerminalReplayState } from './terminalReplayBuffer'

type TerminalRuntimeBase = TerminalReplayState & {
  roomId: string
  roomGeneration: string
  terminalId: string
  launchId: string
  backend: TerminalBackend
  cwdRefreshTimer: ReturnType<typeof setTimeout> | null
  status: TerminalStatus
  cols: number
  rows: number
  exitCode: number | null
  signal: string | null
  terminalRevision: number
  textRevision: number
  outputActivityRevision: number
}

export type ShellTerminalRuntime = TerminalRuntimeBase & {
  backendKind: Exclude<TerminalBackendKind, 'text'>
  cwd: string
}

export type TextTerminalRuntime = TerminalRuntimeBase & {
  backendKind: 'text'
  cwd: null
}

export type TerminalSlot = ShellTerminalRuntime | TextTerminalRuntime

export type TerminalRuntimeStateInput = {
  roomId: string
  roomGeneration: string
  terminalId: string
  launchId: string
  backend: TerminalBackend
  backendKind: TerminalBackendKind
  cwd: string | null
  cols: number
  rows: number
}

export function createTerminalRuntimeState(input: TerminalRuntimeStateInput): TerminalSlot {
  const runtime = {
    roomId: input.roomId,
    roomGeneration: input.roomGeneration,
    terminalId: input.terminalId,
    launchId: input.launchId,
    backend: input.backend,
    cwdRefreshTimer: null,
    status: 'starting' as const,
    cols: input.cols,
    rows: input.rows,
    ...createTerminalReplayFields(),
    exitCode: null,
    signal: null,
    terminalRevision: 1,
    textRevision: 0,
    outputActivityRevision: 0,
  }
  return input.backendKind === 'text'
    ? { ...runtime, backendKind: 'text', cwd: null }
    : { ...runtime, backendKind: input.backendKind, cwd: input.cwd! }
}

export function restartTerminalRuntimeState(
  terminal: TerminalSlot,
  input: Pick<TerminalRuntimeStateInput, 'launchId' | 'backend' | 'backendKind' | 'cwd'>,
): TerminalSlot {
  const runtime = {
    ...terminal,
    launchId: input.launchId,
    backend: input.backend,
    cwdRefreshTimer: null,
    status: 'starting' as const,
    ...createTerminalReplayFields(),
    exitCode: null,
    signal: null,
    terminalRevision: terminal.terminalRevision + 1,
    textRevision: terminal.textRevision + 1,
    outputActivityRevision: terminal.outputActivityRevision + 1,
  }
  return input.backendKind === 'text'
    ? { ...runtime, backendKind: 'text', cwd: null }
    : { ...runtime, backendKind: input.backendKind, cwd: input.cwd! }
}

export function advanceTerminalRuntimeRevision(
  terminal: TerminalSlot,
  options: { text?: boolean; outputActivity?: boolean } = {},
): void {
  terminal.terminalRevision += 1
  if (options.text) terminal.textRevision += 1
  if (options.outputActivity) advanceTerminalOutputActivity(terminal)
}

export function markTerminalRuntimeClosed(terminal: TerminalSlot, exitCode: number | null, signal: string | null): void {
  terminal.status = 'closed'
  terminal.exitCode = exitCode
  terminal.signal = signal
}

export function markTerminalRuntimeFailed(terminal: TerminalSlot): void {
  terminal.status = 'failed'
}
