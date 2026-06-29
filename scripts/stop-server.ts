import { existsSync, readFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'

const port = Number(argValue('--port') ?? '5177')
const pidFile = argValue('--pid-file') ?? defaultPidFile(port)
const timeoutMs = Number(argValue('--timeout-ms') ?? '3000')

if (!existsSync(pidFile)) {
  console.log('shell-deck pid file not found: ' + pidFile)
  process.exit(0)
}

const pidText = readFileSync(pidFile, 'utf8').trim()
const pid = Number(pidText)
if (!Number.isInteger(pid) || pid <= 0) {
  unlinkSync(pidFile)
  throw new Error('invalid shell-deck pid file: ' + pidFile)
}

if (!isProcessRunning(pid)) {
  unlinkSync(pidFile)
  console.log('shell-deck process already stopped; removed stale pid file ' + pidFile)
  process.exit(0)
}

if (!looksLikeShellDeckServer(pid)) {
  throw new Error('refusing to stop pid ' + pid + ' because it does not look like shell-deck server')
}

process.kill(pid, 'SIGTERM')
await waitForExit(pid, timeoutMs)
if (existsSync(pidFile)) unlinkSync(pidFile)
console.log('shell-deck stopped pid ' + pid)

function defaultPidFile(portNumber: number): string {
  return join(process.env.SHELL_DECK_DATA_ROOT ?? join(process.cwd(), '.shell-deck'), 'server-' + portNumber + '.pid')
}

function argValue(name: string): string | undefined {
  const inline = process.argv.find((arg) => arg.startsWith(name + '='))
  if (inline) return inline.slice(name.length + 1)
  const index = process.argv.indexOf(name)
  if (index === -1) return undefined
  return process.argv[index + 1]
}

function isProcessRunning(pidNumber: number): boolean {
  try {
    process.kill(pidNumber, 0)
    return true
  } catch {
    return false
  }
}

function looksLikeShellDeckServer(pidNumber: number): boolean {
  try {
    const cmdline = readFileSync('/proc/' + pidNumber + '/cmdline', 'utf8').replaceAll('\0', ' ')
    return cmdline.includes('server/httpServer.ts') || cmdline.includes('shell-deck')
  } catch {
    return true
  }
}

async function waitForExit(pidNumber: number, timeout: number): Promise<void> {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (!isProcessRunning(pidNumber)) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('shell-deck pid ' + pidNumber + ' did not stop within ' + timeout + 'ms')
}
