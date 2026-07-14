import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createServer } from 'node:net'
import { expect, test } from 'bun:test'

test('stop script terminates only the exact server process recorded in the private PID file', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-032-stop-'))
  const pidFile = join(root, 'server.pid')
  const port = await availablePort()
  const server = spawn(process.execPath, ['run', resolve(import.meta.dir, '../../server/httpServer.ts'), '--port', String(port), '--data-root', root, '--pid-file', pidFile], {
    cwd: resolve(import.meta.dir, '../..'),
    env: { ...process.env, HISTFILE: '/dev/null' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  try {
    await waitFor(() => existsSync(pidFile), 5_000)
    const stopped = spawnSync(process.execPath, ['run', resolve(import.meta.dir, '../../scripts/stop-server.ts'), '--pid-file', pidFile], {
      cwd: resolve(import.meta.dir, '../..'),
      encoding: 'utf8',
    })
    if (stopped.status !== 0) throw new Error('stop_script_failed:' + stopped.stdout + stopped.stderr)
    await waitFor(() => server.exitCode !== null, 5_000)
    expect(existsSync(pidFile)).toBe(false)
  } finally {
    if (server.exitCode === null) server.kill('SIGKILL')
    rmSync(root, { recursive: true, force: true })
  }
}, 15_000)

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await Bun.sleep(20)
  }
  throw new Error('server_stop_identity_timeout')
}

async function availablePort(): Promise<number> {
  const probe = createServer()
  await new Promise<void>((resolveListen, reject) => {
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', resolveListen)
  })
  const address = probe.address()
  const port = typeof address === 'object' && address ? address.port : 0
  await new Promise<void>((resolveClose, reject) => probe.close((error) => error ? reject(error) : resolveClose()))
  if (port === 0) throw new Error('available_port_missing')
  return port
}
