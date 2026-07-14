import { expect, test } from 'bun:test'
import { parseServerCliArgs } from '../../server/httpServer'

test('server CLI accepts only current Room foundation options', () => {
  expect(parseServerCliArgs([])).toEqual({ host: '127.0.0.1', port: 5177 })
  expect(parseServerCliArgs(['--host=0.0.0.0', '--port', '6000', '--data-root', '/tmp/data', '--pid-file=/tmp/server.pid'])).toEqual({
    host: '0.0.0.0', port: 6000, dataRoot: '/tmp/data', pidFile: '/tmp/server.pid',
  })
  for (const option of ['--profile', '--default-project', '--config-id', '--ai-json-parser', '--seed-backend']) {
    expect(() => parseServerCliArgs([option, 'x'])).toThrow('unknown_server_option:' + option)
  }
  expect(() => parseServerCliArgs(['--port', 'nope'])).toThrow('invalid_server_port')
  expect(() => parseServerCliArgs(['--host'])).toThrow('server_option_value_required:--host')
  expect(() => parseServerCliArgs(['--port=1', '--port=2'])).toThrow('duplicate_server_option:--port')
})
