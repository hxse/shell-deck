import { existsSync, readFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { initializeUserDataRoot, resolveUserDataRoot } from '../server/userDataRoot'
import { matchesLiveShellDeckServer, parseServerPidRecord, readLinuxProcessState } from '../server/serverProcessIdentity'

const cli = parseStopCliArgs(process.argv.slice(2))
const port = cli.port
const dataRoot = cli.dataRoot
const pidFile = cli.pidFile ?? defaultPidFile(port, dataRoot)
const timeoutMs = cli.timeoutMs

if (!existsSync(pidFile)) {
  console.log('shell-deck pid file not found: ' + pidFile)
  process.exit(0)
}

const pidRecord = parseServerPidRecord(readFileSync(pidFile, 'utf8'))
const pid = pidRecord.pid

if (!isProcessRunning(pid)) {
  unlinkSync(pidFile)
  console.log('shell-deck process already stopped; removed stale pid file ' + pidFile)
  process.exit(0)
}

if (!matchesLiveShellDeckServer(pidRecord)) {
  throw new Error('refusing to stop pid ' + pid + ' because its process identity does not match the pid file')
}

process.kill(pid, 'SIGTERM')
await waitForExit(pid, timeoutMs)
if (existsSync(pidFile)) unlinkSync(pidFile)
console.log('shell-deck stopped pid ' + pid)

function defaultPidFile(portNumber: number, explicitRoot?: string): string {
  return join(initializeUserDataRoot(explicitRoot ?? resolveUserDataRoot()).locks, 'server-' + portNumber + '.pid')
}

function isProcessRunning(pidNumber: number): boolean {
  try {
    process.kill(pidNumber, 0)
    try { return readLinuxProcessState(pidNumber) !== 'Z' }
    catch { return true }
  } catch {
    return false
  }
}

function parseStopCliArgs(args: string[]) {
  const allowed = new Set(['--port', '--data-root', '--pid-file', '--timeout-ms'])
  const values = new Map<string, string>()
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (!argument.startsWith('--')) throw new Error('unexpected_stop_argument:' + argument)
    const separator = argument.indexOf('=')
    const name = separator === -1 ? argument : argument.slice(0, separator)
    if (!allowed.has(name)) throw new Error('unknown_stop_option:' + name)
    if (values.has(name)) throw new Error('duplicate_stop_option:' + name)
    const value = separator === -1 ? args[++index] : argument.slice(separator + 1)
    if (value === undefined || value.length === 0 || value.startsWith('--')) throw new Error('stop_option_value_required:' + name)
    values.set(name, value)
  }
  const port = Number(values.get('--port') ?? '5177')
  const timeoutMs = Number(values.get('--timeout-ms') ?? '3000')
  if (!Number.isInteger(port) || port < 0 || port > 65_535) throw new Error('invalid_stop_port')
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) throw new Error('invalid_stop_timeout')
  return {
    port,
    timeoutMs,
    dataRoot: values.get('--data-root'),
    pidFile: values.get('--pid-file'),
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
