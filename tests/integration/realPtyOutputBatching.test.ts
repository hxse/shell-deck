import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'bun:test'
import { RealPtyBackend } from '../../server/realPtyBackend'

test('real PTY decodes split UTF-8 and flushes output before exit', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-pty-output-'))
  const executable = join(root, 'split-utf8-output')
  writeFileSync(executable, [
    '#!/bin/sh',
    "printf '\\347'",
    'sleep 0.05',
    "printf '\\225\\214__EXIT_FLUSH__'",
    '',
  ].join('\n'), { mode: 0o755 })

  const backend = new RealPtyBackend({ cols: 80, rows: 24, shell: executable })
  const output: string[] = []
  const order: string[] = []

  try {
    await Promise.race([
      new Promise<void>((resolve, reject) => {
        backend.start({
          onData(data) {
            output.push(data)
            order.push('output')
          },
          onError: reject,
          onExit(exitCode) {
            order.push('exit')
            try {
              expect(exitCode).toBe(0)
              resolve()
            } catch (error) {
              reject(error)
            }
          },
        })
      }),
      Bun.sleep(5000).then(() => { throw new Error('real_pty_output_timeout') }),
    ])

    expect(output.join('')).toContain('界__EXIT_FLUSH__')
    expect(output.join('')).not.toContain('\ufffd')
    expect(order.at(-1)).toBe('exit')
    expect(order.slice(0, -1).every((item) => item === 'output')).toBe(true)
  } finally {
    backend.close()
    rmSync(root, { recursive: true, force: true })
  }
})
