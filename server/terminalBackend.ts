import type { TerminalBackendKind } from '../src/lib/protocol'

export type TerminalBackendEvent = {
  onData(data: string): void
  onExit(exitCode: number | null, signal: string | null): void
  onError(error: Error): void
}

export type TerminalBackend = {
  readonly kind: TerminalBackendKind
  readonly inputChannel: 'helper-stdin-pipe'
  start(events: TerminalBackendEvent): void
  write(data: string): void
  resize(cols: number, rows: number): void
  currentCwd?(): string | null
  close(): Promise<void> | void
}

export type TerminalBackendOptions = {
  cols: number
  rows: number
  shell?: string
  cwd?: string
  serverInstanceId?: string
  roomId?: string
  roomGeneration?: string
  terminalId?: string
  launchId?: string
  env?: Record<string, string | undefined>
}

export type TerminalBackendFactory = (kind: TerminalBackendKind, options: TerminalBackendOptions) => TerminalBackend
