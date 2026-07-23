import { accessSync, constants as fsConstants, statSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import type { ServerMessage } from '../src/lib/protocol'
import type { RoomRuntime } from './roomLifecycleCoordinator'
import { isCurrentTerminal } from './terminalBackendLifecycle'
import type { TerminalSlot } from './terminalRuntimeState'
import { terminalRevisionFields } from './terminalSnapshotProjection'

const CWD_REFRESH_DEBOUNCE_MS = 60

type TerminalCwdCoordinatorOptions = {
  rooms: Map<string, RoomRuntime>
  homeDirectory: string
  terminalOrThrow(room: RoomRuntime, terminalId: string): TerminalSlot
  advanceTerminalRevision(room: RoomRuntime, terminal: TerminalSlot): void
  broadcast(room: RoomRuntime, message: ServerMessage): void
}

type TerminalCwdCreateOptions = {
  cwd?: string
  cwdSource?: 'last-shell'
}

export class TerminalCwdCoordinator {
  constructor(private readonly options: TerminalCwdCoordinatorOptions) {}

  resolveCreateCwd(room: RoomRuntime, options: TerminalCwdCreateOptions): string {
    if (options.cwdSource === undefined) return resolveShellCwd(options.cwd ?? this.options.homeDirectory)
    if (options.cwdSource !== 'last-shell') throw new Error('invalid_terminal_cwd_source')
    for (let index = room.store.terminalOrder.length - 1; index >= 0; index -= 1) {
      const terminal = this.options.terminalOrThrow(room, room.store.terminalOrder[index])
      if (terminal.backendKind === 'text' || terminal.status !== 'running') continue
      return this.refreshTerminalCwd(terminal, true) ?? this.options.homeDirectory
    }
    return this.options.homeDirectory
  }

  scheduleCwdRefresh(terminal: TerminalSlot): void {
    if (!terminal.backend.currentCwd || terminal.backendKind === 'text') return
    this.cancelCwdRefresh(terminal)
    terminal.cwdRefreshTimer = setTimeout(() => {
      terminal.cwdRefreshTimer = null
      if (isCurrentTerminal(this.options.rooms, terminal)) this.refreshTerminalCwd(terminal, true)
    }, CWD_REFRESH_DEBOUNCE_MS)
  }

  refreshTerminalCwd(terminal: TerminalSlot, publish: boolean): string | null {
    if (terminal.backendKind === 'text' || !terminal.backend.currentCwd) return null
    let observed: string | null
    try { observed = terminal.backend.currentCwd() }
    catch { return null }
    if (observed === null) return null
    let cwd: string
    try { cwd = resolveShellCwd(observed) }
    catch { return null }
    if (terminal.cwd === cwd) return cwd
    terminal.cwd = cwd
    if (isCurrentTerminal(this.options.rooms, terminal)) {
      const room = this.options.rooms.get(terminal.roomId)!
      this.options.advanceTerminalRevision(room, terminal)
      if (publish) {
        this.options.broadcast(room, {
          type: 'terminal_cwd',
          roomId: room.roomId,
          roomGeneration: room.roomGeneration,
          terminalId: terminal.terminalId,
          launchId: terminal.launchId,
          cwd,
          ...terminalRevisionFields(room, terminal),
        })
      }
    }
    return cwd
  }

  cancelCwdRefresh(terminal: TerminalSlot): void {
    if (terminal.cwdRefreshTimer === null) return
    clearTimeout(terminal.cwdRefreshTimer)
    terminal.cwdRefreshTimer = null
  }
}

export function resolveShellCwd(value = process.env.HOME): string {
  if (!value || !isAbsolute(value)) throw new Error('shell_cwd_must_be_absolute')
  const cwd = resolve(value)
  let info
  try {
    info = statSync(cwd)
    accessSync(cwd, fsConstants.R_OK | fsConstants.X_OK)
  } catch {
    throw new Error('shell_cwd_not_accessible:' + cwd)
  }
  if (!info.isDirectory()) throw new Error('shell_cwd_not_directory:' + cwd)
  return cwd
}
