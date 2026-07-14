import { expect, test } from 'bun:test'
import { createGeneratedId } from '../../src/lib/generatedId'
import {
  createServerPidRecord,
  matchesLiveShellDeckServer,
  parseServerPidRecord,
  readLinuxProcessStartTime,
} from '../../server/serverProcessIdentity'

test('PID records bind a server instance to the exact Linux process start time', () => {
  const record = createServerPidRecord(process.pid, createGeneratedId('serverInstance'))
  expect(record.processStartTime).toBe(readLinuxProcessStartTime(process.pid))
  expect(parseServerPidRecord(JSON.stringify(record))).toEqual(record)
  expect(matchesLiveShellDeckServer(record)).toBe(false)
})

test('legacy, unknown-field and malformed PID records fail closed', () => {
  const serverInstanceId = createGeneratedId('serverInstance')
  expect(() => parseServerPidRecord(String(process.pid))).toThrow('invalid_shell_deck_pid_file')
  expect(() => parseServerPidRecord(JSON.stringify({ schemaVersion: 1, pid: process.pid, processStartTime: '1', serverInstanceId, extra: true }))).toThrow('invalid_shell_deck_pid_file')
  expect(matchesLiveShellDeckServer({ schemaVersion: 1, pid: 2_147_483_647, processStartTime: '1', serverInstanceId })).toBe(false)
})
