import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'bun:test'
import { NotificationService, notificationProfilesPath, telegramText } from '../../server/notificationService'
import { createGeneratedId } from '../../src/lib/generatedId'

test('notification profile path is a fixed User Data Root file', () => {
  expect(notificationProfilesPath('/tmp/shell-deck-root')).toBe('/tmp/shell-deck-root/notification-profiles.json')
})

test('telegram text includes notification metadata when provided', () => {
  const notificationId = createGeneratedId('notification')
  const runId = createGeneratedId('run')
  const text = telegramText('Done', 'body', { createdAt: '2026-07-09T01:02:03.000Z', notificationId, runId, stepId: 'notify_done' })
  expect(text).toContain('time: 2026-07-09T01:02:03.000Z')
  expect(text).toContain('notification_id: ' + notificationId)
  expect(text).toContain('run_id: ' + runId)
  expect(text).toContain('step_id: notify_done')
})

test('telegram text keeps multiline content inside one message field', () => {
  const text = telegramText('Done', 'line one\nline two', { level: 'info' })
  expect(text.split('\n')).toEqual(['title: Done', 'level: info', 'message: line one\\nline two'])
})

test('telegram send uses local profile token and channel without exposing them in result', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-notify-'))
  try {
    writeConfig(root, { telegram: { profiles: { default: { botToken: 'token-secret', channelId: '-10042', disableWebPagePreview: true } } } })
    const calls: Array<{ input: string; init: RequestInit }> = []
    const service = new NotificationService(root, async (input, init) => {
      calls.push({ input, init })
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    })
    const result = await service.sendTelegram({ profileId: 'default', title: 'Done', message: 'See https://example.test', level: 'success' })
    expect(result.ok).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0].input).toContain('/bottoken-secret/sendMessage')
    const body = JSON.parse(String(calls[0].init.body))
    expect(body.chat_id).toBe('-10042')
    expect(body.disable_web_page_preview).toBe(true)
    expect(body.text).toBe('title: Done\nlevel: success\nmessage: See https://example.test')
    expect(JSON.stringify(result)).not.toContain('token-secret')
    expect(JSON.stringify(result)).not.toContain('-10042')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('telegram profile failures are explicit and offline safe', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-notify-missing-'))
  try {
    const service = new NotificationService(root, async () => new Response('{}', { status: 200 }))
    const result = await service.sendTelegram({ profileId: 'default', title: 'Done', message: 'body', level: 'info' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('profile_missing')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('telegram text truncates oversized messages', () => {
  const text = telegramText('Title', 'x'.repeat(5000))
  expect(text.length).toBeLessThanOrEqual(3915)
  expect(text.endsWith('[truncated]')).toBe(true)
})

test('lists telegram profile ids from local config without exposing secrets', () => {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-notify-list-'))
  try {
    writeConfig(root, { telegram: { profiles: { beta: { botToken: 'b', channelId: '-1002' }, default: { botToken: 'd', channelId: '-1001' } } } })
    const service = new NotificationService(root)
    expect(service.listTelegramProfileIds()).toEqual(['beta', 'default'])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})


test('telegram fetch failures return sanitized transport errors', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-notify-sanitize-'))
  try {
    writeConfig(root, { telegram: { profiles: { default: { botToken: 'token-secret', channelId: '-10042' } } } })
    const service = new NotificationService(root, async () => {
      throw new Error('connect failed https://api.telegram.org/bottoken-secret/sendMessage chat -10042')
    })
    const result = await service.sendTelegram({ profileId: 'default', title: 'Done', message: 'body', level: 'error' })
    expect(result.ok).toBe(false)
    expect(JSON.stringify(result)).not.toContain('token-secret')
    expect(JSON.stringify(result)).not.toContain('-10042')
    expect(JSON.stringify(result)).not.toContain('api.telegram.org')
    if (!result.ok) {
      expect(result.code).toBe('telegram_fetch_failed')
      expect(result.message).toBe('Telegram send failed')
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

function writeConfig(root: string, value: unknown): void {
  writeFileSync(join(root, 'notification-profiles.json'), JSON.stringify(value), { encoding: 'utf8', mode: 0o600 })
}
