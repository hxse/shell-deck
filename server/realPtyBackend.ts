import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, mkdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { chunkInput, encodeControlFrame, HELPER_INPUT_CHANNEL } from './ptyControl'
import type { TerminalBackend, TerminalBackendEvent, TerminalBackendOptions } from './terminalBackend'

export class RealPtyBackend implements TerminalBackend {
  readonly kind = 'real' as const
  readonly inputChannel = HELPER_INPUT_CHANNEL
  readonly shell: string
  readonly shellDeckEnv: Record<string, string | undefined>
  #events: TerminalBackendEvent | null = null
  #child: ChildProcessWithoutNullStreams | null = null
  #closed = false
  cols: number
  rows: number

  constructor(options: TerminalBackendOptions) {
    this.cols = options.cols
    this.rows = options.rows
    this.shell = options.shell ?? process.env.SHELL ?? '/run/current-system/sw/bin/bash'
    this.shellDeckEnv = {
      ...options.env,
      ...(options.configId ? { SHELL_DECK_CONFIG_ID: options.configId } : {}),
      ...(options.terminalId ? { SHELL_DECK_TERMINAL_ID: options.terminalId } : {}),
      ...(options.launchId ? { SHELL_DECK_LAUNCH_ID: options.launchId } : {}),
    }
  }

  start(events: TerminalBackendEvent): void {
    this.#events = events
    const helper = ensurePtyHelper()
    const child = spawn(helper, [String(this.cols), String(this.rows), ...this.shellCommand()], {
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        PS1: '$ ',
        ...this.shellDeckEnv,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    this.#child = child
    child.stdout.on('data', (data) => events.onData(data.toString()))
    child.stderr.on('data', (data) => events.onError(new Error(data.toString().trim())))
    child.on('error', (error) => events.onError(error))
    child.on('exit', (code, signal) => {
      this.#closed = true
      events.onExit(code, signal)
    })
  }

  write(data: string): void {
    if (this.#closed || !this.#child?.stdin.writable) {
      return
    }
    for (const chunk of chunkInput(data)) {
      this.#child.stdin.write(encodeControlFrame({ type: 'input', data: chunk }))
    }
  }

  resize(cols: number, rows: number): void {
    this.cols = cols
    this.rows = rows
    if (this.#closed || !this.#child?.stdin.writable) {
      return
    }
    this.#child.stdin.write(encodeControlFrame({ type: 'resize', cols, rows }))
  }

  close(): void {
    if (this.#closed) {
      return
    }
    this.#closed = true
    if (this.#child?.stdin.writable) {
      this.#child.stdin.write(encodeControlFrame({ type: 'close' }))
    }
    setTimeout(() => this.#child?.kill('SIGTERM'), 200).unref()
  }

  private shellCommand(): string[] {
    return this.shell.includes('bash')
      ? [this.shell, '--noprofile', '--norc', '-i']
      : [this.shell]
  }
}

function ensurePtyHelper(): string {
  const root = process.cwd()
  const source = join(root, 'server', 'ptyHelper.c')
  const outputDir = join(root, '.shell-deck', 'bin')
  const output = join(outputDir, 'pty-helper')
  mkdirSync(outputDir, { recursive: true })
  if (!needsBuild(source, output)) {
    return output
  }

  const attempts = [
    ['cc', source, '-O2', '-Wall', '-Wextra', '-o', output, '-lutil'],
    ['cc', source, '-O2', '-Wall', '-Wextra', '-o', output],
  ]
  const errors: string[] = []
  for (const command of attempts) {
    const result = spawnSync(command[0], command.slice(1), { encoding: 'utf8' })
    if (result.status === 0) {
      return output
    }
    errors.push((result.stderr || result.stdout || 'unknown compiler error').trim())
  }
  throw new Error('pty_helper_build_failed:' + errors.join('\n'))
}

function needsBuild(source: string, output: string): boolean {
  if (!existsSync(output)) return true
  return statSync(output).mtimeMs < statSync(source).mtimeMs
}
