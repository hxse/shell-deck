import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'bun:test'
import { startShellDeckServer } from '../../server/httpServer'

test('notification profile endpoint returns user-root profile ids without secrets', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-notify-http-'))
  let server: ReturnType<typeof startShellDeckServer> | null = null
  try {
    writeConfig(root, JSON.stringify({ telegram: { profiles: { default: { botToken: 'secret-token', channelId: '-1001' }, ops: { botToken: 'ops-token', channelId: '-1002' } } } }))
    server = startShellDeckServer({ accessMode: 'guest', listenMode: 'local', port: 0, dataRoot: root })
    const response = await fetch(server.url + '/api/notification-profiles/telegram')
    expect(response.status).toBe(200)
    const body = await response.json() as { profiles: string[] }
    expect(body.profiles).toEqual(['default', 'ops'])
    expect(JSON.stringify(body)).not.toContain('secret-token')
    expect(JSON.stringify(body)).not.toContain('-100')
  } finally {
    if (server) await server.stop()
    rmSync(root, { recursive: true, force: true })
  }
})

test('notification profile endpoint fails closed on invalid user config', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-notify-http-invalid-'))
  let server: ReturnType<typeof startShellDeckServer> | null = null
  try {
    writeConfig(root, '{bad json')
    server = startShellDeckServer({ accessMode: 'guest', listenMode: 'local', port: 0, dataRoot: root })
    const response = await fetch(server.url + '/api/notification-profiles/telegram')
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ ok: false, error: 'notification_profiles_invalid_json' })
  } finally {
    if (server) await server.stop()
    rmSync(root, { recursive: true, force: true })
  }
})

function writeConfig(root: string, content: string): void {
  writeFileSync(join(root, 'notification-profiles.json'), content, { encoding: 'utf8', mode: 0o600 })
}
