import { expect, test } from 'bun:test'
import { parseServerCliArgs, startShellDeckServer } from '../../server/httpServer'

test('server CLI requires exact access and listen modes', () => {
  expect(parseServerCliArgs(['--access-mode=guest', '--listen-mode', 'local'])).toEqual({ accessMode: 'guest', listenMode: 'local', port: 5177 })
  expect(parseServerCliArgs(['--access-mode=authenticated', '--listen-mode=lan', '--port', '6000', '--data-root', '/tmp/data', '--pid-file=/tmp/server.pid'])).toEqual({
    accessMode: 'authenticated', listenMode: 'lan', port: 6000, dataRoot: '/tmp/data', pidFile: '/tmp/server.pid',
  })
  expect(() => parseServerCliArgs([])).toThrow('server_access_mode_required')
  expect(() => parseServerCliArgs(['--access-mode', 'guest'])).toThrow('server_listen_mode_required')
  expect(() => parseServerCliArgs(['--access-mode', 'public', '--listen-mode', 'local'])).toThrow('invalid_server_access_mode')
  expect(() => parseServerCliArgs(['--access-mode', 'guest', '--listen-mode', 'public'])).toThrow('invalid_server_listen_mode')
  for (const option of ['--profile', '--default-project', '--config-id', '--ai-json-parser', '--seed-backend']) {
    expect(() => parseServerCliArgs(['--access-mode', 'guest', '--listen-mode', 'local', option, 'x'])).toThrow('unknown_server_option:' + option)
  }
  const modes = ['--access-mode', 'guest', '--listen-mode', 'local']
  expect(() => parseServerCliArgs([...modes, '--port', 'nope'])).toThrow('invalid_server_port')
  expect(() => parseServerCliArgs([...modes, '--host', '0.0.0.0'])).toThrow('unknown_server_option:--host')
  expect(() => parseServerCliArgs([...modes, '--port=1', '--port=2'])).toThrow('duplicate_server_option:--port')
})

test('programmatic startup independently validates required modes and legacy input', () => {
  expect(() => startShellDeckServer(undefined as never)).toThrow('server_access_mode_required')
  expect(() => startShellDeckServer({} as never)).toThrow('server_access_mode_required')
  expect(() => startShellDeckServer({ accessMode: 'guest' } as never)).toThrow('server_listen_mode_required')
  expect(() => startShellDeckServer({ accessMode: 'invalid', listenMode: 'local' } as never)).toThrow('invalid_server_access_mode')
  expect(() => startShellDeckServer({ accessMode: 'guest', listenMode: 'invalid' } as never)).toThrow('invalid_server_listen_mode')
  process.env.SHELL_DECK_ALLOW_LAN = ''
  try {
    expect(() => startShellDeckServer({ accessMode: 'guest', listenMode: 'local' })).toThrow('legacy_shell_deck_allow_lan_unsupported')
  } finally { delete process.env.SHELL_DECK_ALLOW_LAN }
})
