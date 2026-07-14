import { basename } from 'node:path'
import { readFileSync } from 'node:fs'
import { assertGeneratedId } from '../src/lib/generatedId'

export type ServerPidRecord = {
  schemaVersion: 1
  pid: number
  processStartTime: string
  serverInstanceId: string
}

export function createServerPidRecord(pid: number, serverInstanceId: string): ServerPidRecord {
  return {
    schemaVersion: 1,
    pid: assertPid(pid),
    processStartTime: readLinuxProcessStartTime(pid),
    serverInstanceId: assertGeneratedId(serverInstanceId, 'serverInstance'),
  }
}

export function parseServerPidRecord(text: string): ServerPidRecord {
  let value: unknown
  try { value = JSON.parse(text) }
  catch { throw new Error('invalid_shell_deck_pid_file') }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_shell_deck_pid_file')
  const record = value as Record<string, unknown>
  const keys = Object.keys(record).sort()
  if (keys.join(',') !== 'pid,processStartTime,schemaVersion,serverInstanceId') throw new Error('invalid_shell_deck_pid_file')
  if (record.schemaVersion !== 1 || typeof record.processStartTime !== 'string' || !/^\d+$/.test(record.processStartTime)) {
    throw new Error('invalid_shell_deck_pid_file')
  }
  return {
    schemaVersion: 1,
    pid: assertPid(record.pid),
    processStartTime: record.processStartTime,
    serverInstanceId: assertGeneratedId(record.serverInstanceId, 'serverInstance'),
  }
}

export function matchesLiveShellDeckServer(record: ServerPidRecord): boolean {
  try {
    if (readLinuxProcessStartTime(record.pid) !== record.processStartTime) return false
    const arguments_ = readFileSync('/proc/' + record.pid + '/cmdline').toString('utf8').split('\0').filter(Boolean)
    if (arguments_.length < 2 || basename(arguments_[0]) !== 'bun') return false
    return arguments_.some((argument, index) => index > 0 && (argument === 'server/httpServer.ts' || argument.endsWith('/server/httpServer.ts')))
  } catch {
    return false
  }
}

export function readLinuxProcessStartTime(pid: number): string {
  const fieldsAfterCommand = readLinuxProcessFields(pid)
  const startTime = fieldsAfterCommand[19]
  if (!startTime || !/^\d+$/.test(startTime)) throw new Error('process_stat_invalid')
  return startTime
}

export function readLinuxProcessState(pid: number): string {
  const state = readLinuxProcessFields(pid)[0]
  if (!state || !/^[A-Z]$/.test(state)) throw new Error('process_stat_invalid')
  return state
}

function readLinuxProcessFields(pid: number): string[] {
  const raw = readFileSync('/proc/' + assertPid(pid) + '/stat', 'utf8')
  const commandEnd = raw.lastIndexOf(')')
  if (commandEnd < 0) throw new Error('process_stat_invalid')
  return raw.slice(commandEnd + 1).trim().split(/\s+/)
}

function assertPid(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) throw new Error('invalid_shell_deck_pid_file')
  return value as number
}
