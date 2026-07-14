import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process'
import {
  chmodSync,
  closeSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readlinkSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { createGeneratedSuffix } from '../src/lib/generatedId'
import { chunkInput, encodeControlFrame, HELPER_INPUT_CHANNEL } from './ptyControl'
import { PtyOutputBatcher, type PtyOutputBatchScheduler } from './ptyOutputBatcher'
import type { TerminalBackend, TerminalBackendEvent, TerminalBackendOptions } from './terminalBackend'

export const DEFAULT_REAL_SHELL_PROMPT = '\\[\\e[1;92m\\][\\u@\\h:\\w]\\$\\[\\e[0m\\] '
export const DEFAULT_REAL_SHELL_ALIAS_LINES = [
  "alias ls='ls --color=auto'",
  "alias ll='ls -alF --color=auto'",
  "alias la='ls -A --color=auto'",
  "alias l='ls -CF --color=auto'",
  "alias grep='grep --color=auto'",
  "alias diff='diff --color=auto'",
] as const

export type RealPtyBackendDependencies = {
  outputBatchScheduler?: PtyOutputBatchScheduler
}

let cachedPtyHelper: string | null = null

export class RealPtyBackend implements TerminalBackend {
  readonly kind = 'real' as const
  readonly inputChannel = HELPER_INPUT_CHANNEL
  readonly shell: string
  readonly shellDeckEnv: Record<string, string | undefined>
  readonly cwd: string
  #events: TerminalBackendEvent | null = null
  #child: ChildProcessWithoutNullStreams | null = null
  #shellPid: number | null = null
  #outputBatcher: PtyOutputBatcher | null = null
  #outputBatchScheduler: PtyOutputBatchScheduler | undefined
  #closed = false
  #closing = false
  #exitPromise: Promise<void> = Promise.resolve()
  #resolveExit: (() => void) | null = null
  cols: number
  rows: number

  constructor(options: TerminalBackendOptions, dependencies: RealPtyBackendDependencies = {}) {
    this.cols = options.cols
    this.rows = options.rows
    this.#outputBatchScheduler = dependencies.outputBatchScheduler
    this.shell = options.shell ?? process.env.SHELL ?? '/run/current-system/sw/bin/bash'
    this.cwd = defaultRealShellCwd(options.cwd)
    this.shellDeckEnv = {
      ...options.env,
      ...(options.serverInstanceId ? { SHELL_DECK_SERVER_INSTANCE_ID: options.serverInstanceId } : {}),
      ...(options.roomId ? { SHELL_DECK_ROOM_ID: options.roomId } : {}),
      ...(options.roomGeneration ? { SHELL_DECK_ROOM_GENERATION: options.roomGeneration } : {}),
      ...(options.terminalId ? { SHELL_DECK_TERMINAL_ID: options.terminalId } : {}),
      ...(options.launchId ? { SHELL_DECK_LAUNCH_ID: options.launchId } : {}),
    }
  }

  start(events: TerminalBackendEvent): void {
    this.#events = events
    this.#exitPromise = new Promise((resolveExit) => { this.#resolveExit = resolveExit })
    const helper = ensurePtyHelper()
    const child = spawn(helper, [String(this.cols), String(this.rows), ...this.shellCommand()], {
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        PS1: DEFAULT_REAL_SHELL_PROMPT,
        ...this.shellDeckEnv,
      },
      cwd: this.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    this.#child = child
    const outputBatcher = new PtyOutputBatcher({
      onBatch: (data) => events.onData(data),
      ...(this.#outputBatchScheduler ? { scheduler: this.#outputBatchScheduler } : {}),
    })
    this.#outputBatcher = outputBatcher
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (data: string) => outputBatcher.push(data))
    child.stderr.on('data', (data: string) => {
      outputBatcher.flush()
      events.onError(new Error(data.trim()))
    })
    child.on('error', (error) => {
      outputBatcher.flush()
      events.onError(error)
    })
    child.on('close', (code, signal) => {
      outputBatcher.flush()
      this.#outputBatcher = null
      this.#closed = true
      this.#resolveExit?.()
      this.#resolveExit = null
      events.onExit(code, signal)
    })
  }

  write(data: string): void {
    if (this.#closed || this.#closing || !this.#child?.stdin.writable) {
      return
    }
    for (const chunk of chunkInput(data)) {
      this.#child.stdin.write(encodeControlFrame({ type: 'input', data: chunk }))
    }
  }

  resize(cols: number, rows: number): void {
    this.#outputBatcher?.flush()
    this.cols = cols
    this.rows = rows
    if (this.#closed || this.#closing || !this.#child?.stdin.writable) {
      return
    }
    this.#child.stdin.write(encodeControlFrame({ type: 'resize', cols, rows }))
  }

  currentCwd(): string | null {
    if (this.#closed || this.#closing) return null
    try {
      const shellPid = this.#shellPid ?? this.#discoverShellPid()
      if (shellPid === null) return null
      this.#shellPid = shellPid
      return defaultRealShellCwd(readlinkSync('/proc/' + shellPid + '/cwd'))
    } catch {
      this.#shellPid = null
      return null
    }
  }

  close(): Promise<void> {
    if (this.#closed || this.#closing) return this.#exitPromise
    this.#closing = true
    this.#outputBatcher?.flush()
    const child = this.#child
    if (!child) {
      this.#closed = true
      this.#resolveExit?.()
      this.#resolveExit = null
      return this.#exitPromise
    }
    try {
      if (child.stdin.writable) child.stdin.write(encodeControlFrame({ type: 'close' }))
      else child.kill('SIGTERM')
    } catch {
      child.kill('SIGTERM')
    }
    const terminate = setTimeout(() => child.kill('SIGTERM'), 200)
    const force = setTimeout(() => child.kill('SIGKILL'), 1500)
    void this.#exitPromise.finally(() => {
      clearTimeout(terminate)
      clearTimeout(force)
    })
    return this.#exitPromise
  }

  private shellCommand(): string[] {
    return this.shell.includes('bash')
      ? [this.shell, '--noprofile', '--rcfile', ensureRealShellBashrc(), '-i']
      : [this.shell]
  }

  #discoverShellPid(): number | null {
    const helperPid = this.#child?.pid
    if (!helperPid) return null
    const children = readFileSync('/proc/' + helperPid + '/task/' + helperPid + '/children', 'utf8').trim().split(/\s+/)
    if (children.length === 0 || children[0] === '') return null
    const shellPid = Number(children[0])
    return Number.isSafeInteger(shellPid) && shellPid > 0 ? shellPid : null
  }
}

export function defaultRealShellCwd(value = process.env.HOME): string {
  if (!value || !isAbsolute(value)) throw new Error('shell_cwd_must_be_absolute')
  const cwd = resolve(value)
  try {
    if (statSync(cwd).isDirectory()) return cwd
  } catch {}
  throw new Error('shell_cwd_not_accessible:' + cwd)
}

function ensureRealShellBashrc(): string {
  const outputDir = join(runtimeRoot(), 'etc')
  const output = join(outputDir, 'bashrc')
  ensureRuntimeDirectory(outputDir)
  const content = [
    '# Generated by shell-deck. Do not edit.',
    '# User profile files are intentionally skipped for deterministic startup.',
    `PS1='${DEFAULT_REAL_SHELL_PROMPT}'`,
    ...DEFAULT_REAL_SHELL_ALIAS_LINES,
    '',
  ].join('\n')
  const existing = managedRegularFileState(output, 0o600)
  if (existing === 'missing' || readFileSync(output, 'utf8') !== content) {
    writeManagedFileAtomic(outputDir, output, content, 0o600)
  }
  return output
}

function ensurePtyHelper(): string {
  const source = join(import.meta.dir, 'ptyHelper.c')
  const outputDir = join(runtimeRoot(), 'bin')
  const output = join(outputDir, 'pty-helper')
  ensureRuntimeDirectory(outputDir)
  if (cachedPtyHelper === output) {
    managedRegularFileState(output, 0o700)
    return output
  }

  managedRegularFileState(output, 0o700)

  const temporary = output + '.' + createGeneratedSuffix() + '.tmp'

  const attempts = [
    ['cc', source, '-O2', '-Wall', '-Wextra', '-o', temporary, '-lutil'],
    ['cc', source, '-O2', '-Wall', '-Wextra', '-o', temporary],
  ]
  const errors: string[] = []
  for (const command of attempts) {
    const result = spawnSync(command[0], command.slice(1), { encoding: 'utf8' })
    if (result.status === 0) {
      chmodSync(temporary, 0o700)
      assertManagedRegularFile(temporary, 0o700)
      fsyncFile(temporary)
      renameSync(temporary, output)
      fsyncDirectory(outputDir)
      assertManagedRegularFile(output, 0o700)
      cachedPtyHelper = output
      return output
    }
    errors.push((result.stderr || result.stdout || 'unknown compiler error').trim())
  }
  try { unlinkSync(temporary) } catch {}
  throw new Error('pty_helper_build_failed:' + errors.join('\n'))
}

function runtimeRoot(): string {
  const configured = process.env.XDG_RUNTIME_DIR
  const base = configured && isAbsolute(configured) ? configured : tmpdir()
  const uid = typeof process.getuid === 'function' ? process.getuid() : 'user'
  const path = join(base, 'shell-deck-' + uid)
  ensureRuntimeDirectory(path)
  return path
}

function ensureRuntimeDirectory(path: string): void {
  try { mkdirSync(path, { mode: 0o700 }) }
  catch (error) {
    if (!isAlreadyExists(error)) throw error
  }
  const info = lstatSync(path)
  if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('pty_runtime_path_not_private_directory:' + path)
  assertCurrentUid(info.uid, path)
  if ((info.mode & 0o077) !== 0 || (info.mode & 0o700) !== 0o700) throw new Error('pty_runtime_directory_permissions_invalid:' + path)
}

function managedRegularFileState(path: string, mode: number): 'missing' | 'valid' {
  let info
  try { info = lstatSync(path) }
  catch (error) {
    if (isMissing(error)) return 'missing'
    throw error
  }
  if (info.isSymbolicLink() || !info.isFile()) throw new Error('pty_runtime_file_not_regular:' + path)
  assertCurrentUid(info.uid, path)
  if ((info.mode & 0o777) !== mode) throw new Error('pty_runtime_file_permissions_invalid:' + path)
  return 'valid'
}

function assertManagedRegularFile(path: string, mode: number): void {
  const info = lstatSync(path)
  if (info.isSymbolicLink() || !info.isFile()) throw new Error('pty_runtime_file_not_regular:' + path)
  assertCurrentUid(info.uid, path)
  if ((info.mode & 0o777) !== mode) throw new Error('pty_runtime_file_permissions_invalid:' + path)
}

function assertCurrentUid(ownerUid: number, path: string): void {
  if (typeof process.getuid === 'function' && ownerUid !== process.getuid()) throw new Error('pty_runtime_path_owner_invalid:' + path)
}

function writeManagedFileAtomic(directory: string, target: string, content: string, mode: number): void {
  const temporary = target + '.' + createGeneratedSuffix() + '.tmp'
  try {
    writeFileSync(temporary, content, { encoding: 'utf8', flag: 'wx', mode })
    assertManagedRegularFile(temporary, mode)
    fsyncFile(temporary)
    renameSync(temporary, target)
    fsyncDirectory(directory)
    assertManagedRegularFile(target, mode)
  } catch (error) {
    try { unlinkSync(temporary) } catch {}
    throw error
  }
}

function fsyncFile(path: string): void {
  const descriptor = openSync(path, 'r')
  try { fsyncSync(descriptor) } finally { closeSync(descriptor) }
}

function fsyncDirectory(path: string): void {
  const descriptor = openSync(path, 'r')
  try { fsyncSync(descriptor) } finally { closeSync(descriptor) }
}

function isAlreadyExists(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'EEXIST'
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}
