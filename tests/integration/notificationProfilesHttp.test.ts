import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'bun:test'
import { startShellDeckServer } from '../../server/httpServer'

test('telegram notification profiles endpoint returns profile ids only', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-notify-http-'))
  const oldRoot = process.env.SHELL_DECK_DATA_ROOT
  process.env.SHELL_DECK_DATA_ROOT = root
  let server: ReturnType<typeof startShellDeckServer> | null = null
  try {
    mkdirSync(join(root, '.shell-deck'), { recursive: true })
    writeFileSync(join(root, '.shell-deck', 'notification-profiles.json'), JSON.stringify({ telegram: { profiles: { default: { botToken: 'secret-token', channelId: '-1001' }, ops: { botToken: 'ops-token', channelId: '-1002' } } } }), 'utf8')
    server = startShellDeckServer({ port: 0, seed: false })
    const response = await fetch(server.url + '/api/notification-profiles/telegram')
    expect(response.status).toBe(200)
    const body = await response.json() as { profiles: Array<{ profileId: string }> }
    expect(body.profiles.map((profile) => profile.profileId)).toEqual(['default', 'ops'])
    expect(JSON.stringify(body)).not.toContain('secret-token')
    expect(JSON.stringify(body)).not.toContain('-100')
  } finally {
    server?.stop()
    if (oldRoot === undefined) delete process.env.SHELL_DECK_DATA_ROOT
    else process.env.SHELL_DECK_DATA_ROOT = oldRoot
    rmSync(root, { recursive: true, force: true })
  }
})


test('telegram notification profiles endpoint degrades invalid local config to empty catalog', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-notify-http-invalid-'))
  const oldRoot = process.env.SHELL_DECK_DATA_ROOT
  process.env.SHELL_DECK_DATA_ROOT = root
  let server: ReturnType<typeof startShellDeckServer> | null = null
  try {
    mkdirSync(join(root, '.shell-deck'), { recursive: true })
    writeFileSync(join(root, '.shell-deck', 'notification-profiles.json'), '{bad json', 'utf8')
    server = startShellDeckServer({ port: 0, seed: false })
    const response = await fetch(server.url + '/api/notification-profiles/telegram')
    expect(response.status).toBe(200)
    const body = await response.json() as { ok: boolean; profiles: Array<{ profileId: string }>; error?: string }
    expect(body.ok).toBe(false)
    expect(body.profiles).toEqual([])
    expect(body.error).toBe('notification_profiles_invalid_json')
  } finally {
    server?.stop()
    if (oldRoot === undefined) delete process.env.SHELL_DECK_DATA_ROOT
    else process.env.SHELL_DECK_DATA_ROOT = oldRoot
    rmSync(root, { recursive: true, force: true })
  }
})
