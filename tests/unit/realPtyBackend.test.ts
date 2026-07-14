import { homedir } from 'node:os'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'bun:test'
import { DEFAULT_REAL_SHELL_ALIAS_LINES, DEFAULT_REAL_SHELL_PROMPT, RealPtyBackend, defaultRealShellCwd } from '../../server/realPtyBackend'

test('real shell defaults to home cwd and a path prompt', () => {
  expect(DEFAULT_REAL_SHELL_PROMPT).toBe('\\[\\e[1;92m\\][\\u@\\h:\\w]\\$\\[\\e[0m\\] ')
  const home = homedir()
  if (home) expect(defaultRealShellCwd()).toBe(home)
  expect(DEFAULT_REAL_SHELL_ALIAS_LINES).toContain("alias ls='ls --color=auto'")
})

test('real shell leaves history policy to its caller', () => {
  const production = new RealPtyBackend({ cols: 80, rows: 24 })
  const isolatedTest = new RealPtyBackend({ cols: 80, rows: 24, env: { HISTFILE: '/dev/null' } })

  expect(production.shellDeckEnv.HISTFILE).toBeUndefined()
  expect(isolatedTest.shellDeckEnv.HISTFILE).toBe('/dev/null')
})

test('official leaf test scripts isolate shell history', () => {
  const packageJson = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
    scripts: Record<string, string>
  }

  expect(packageJson.scripts['test:unit:core']).toStartWith('HISTFILE=/dev/null ')
  expect(packageJson.scripts['test:integration']).toStartWith('HISTFILE=/dev/null ')
})

test('real PTY runtime rejects a pre-positioned symlink directory', () => {
  const base = mkdtempSync(join(tmpdir(), 'shell-deck-032-runtime-link-'))
  const target = join(base, 'target')
  mkdirSync(target, { mode: 0o700 })
  const uid = typeof process.getuid === 'function' ? process.getuid() : 'user'
  symlinkSync(target, join(base, 'shell-deck-' + uid))
  withRuntimeDirectory(base, () => {
    const backend = new RealPtyBackend({ cols: 80, rows: 24 })
    expect(() => backend.start(noopEvents())).toThrow('pty_runtime_path_not_private_directory')
  })
  rmSync(base, { recursive: true, force: true })
})

test('real PTY runtime rejects a pre-positioned helper symlink instead of trusting metadata', () => {
  const base = mkdtempSync(join(tmpdir(), 'shell-deck-032-helper-link-'))
  const uid = typeof process.getuid === 'function' ? process.getuid() : 'user'
  const runtime = join(base, 'shell-deck-' + uid)
  const bin = join(runtime, 'bin')
  mkdirSync(bin, { recursive: true, mode: 0o700 })
  chmodSync(runtime, 0o700)
  chmodSync(bin, 0o700)
  const target = join(base, 'attacker-helper')
  writeFileSync(target, '#!/bin/sh\nexit 0\n', { mode: 0o700 })
  symlinkSync(target, join(bin, 'pty-helper'))
  withRuntimeDirectory(base, () => {
    const backend = new RealPtyBackend({ cols: 80, rows: 24 })
    expect(() => backend.start(noopEvents())).toThrow('pty_runtime_file_not_regular')
  })
  rmSync(base, { recursive: true, force: true })
})

function withRuntimeDirectory(path: string, run: () => void): void {
  const previous = process.env.XDG_RUNTIME_DIR
  process.env.XDG_RUNTIME_DIR = path
  try { run() } finally {
    if (previous === undefined) delete process.env.XDG_RUNTIME_DIR
    else process.env.XDG_RUNTIME_DIR = previous
  }
}

function noopEvents() {
  return {
    onData() {},
    onExit() {},
    onError() {},
  }
}
