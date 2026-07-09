import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'bun:test'
import { AgentEventStore } from '../../src/lib/agentEvents/agentEventStore'
import { MacroTemplateStore } from '../../src/lib/macro/templateStore'
import type { MacroTemplate } from '../../src/lib/macro/templateTypes'
import { ParserRuntime } from '../../src/lib/parser/parserRuntime'
import { RunEventStore } from '../../src/lib/runLog/runEventStore'
import { TerminalDeckManager } from '../../server/terminalDeckManager'
import { MacroRunnerService } from '../../server/macroRunnerService'
import { NotificationService, type NotificationDispatcher, type TelegramNotificationRequest, type TelegramNotificationResult } from '../../server/notificationService'

function template(id: string, body: MacroTemplate['body']): MacroTemplate {
  const now = '2026-01-01T00:00:00.000Z'
  return { schemaVersion: 2, id, name: id, description: '', configId: 'local', body, createdAt: now, updatedAt: now }
}

function harness(dispatcher: NotificationDispatcher | ((root: string) => NotificationDispatcher)) {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-notify-runner-'))
  const manager = new TerminalDeckManager()
  manager.createTerminal('local', { backend: 'fake', terminalAlias: 'worker' })
  const runStore = new RunEventStore(root)
  const templateStore = new MacroTemplateStore(root)
  const agentStore = new AgentEventStore(root)
  const notificationDispatcher = typeof dispatcher === 'function' ? dispatcher(root) : dispatcher
  const service = new MacroRunnerService(manager, templateStore, runStore, agentStore, new ParserRuntime(runStore), notificationDispatcher)
  return { root, manager, runStore, templateStore, service, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

test('notify action broadcasts app/system notification and sends telegram server-side', async () => {
  const telegramRequests: TelegramNotificationRequest[] = []
  const dispatcher: NotificationDispatcher = {
    async sendTelegram(request) {
      telegramRequests.push(request)
      return { ok: true, profileId: request.profileId, status: 200 }
    },
  }
  const h = harness(dispatcher)
  try {
    const messages: unknown[] = []
    h.manager.connectClient('local', (message) => messages.push(message), 'notify_client')
    h.templateStore.save('local', template('notify_flow', [
      { id: 'notify_done', type: 'notify', level: 'success', title: 'Done', message: { parts: [{ kind: 'text', text: 'macro finished' }] }, channels: [{ kind: 'app', toast: true, sound: 'bell' }, { kind: 'system' }, { kind: 'telegram', profileId: 'default' }], onFailure: 'continue' },
      { id: 'finish_done', type: 'finish', reason: 'done' },
    ]), h.manager.indexMap('local'))
    await h.service.start('local', { templateId: 'notify_flow' })
    await waitFor(() => h.service.snapshot('local').status === 'completed')
    expect(telegramRequests).toHaveLength(1)
    expect(telegramRequests[0].profileId).toBe('default')
    expect(telegramRequests[0].runId).toMatch(/^run_/)
    expect(telegramRequests[0].stepId).toBe('notify_done')
    expect(telegramRequests[0].notificationId).toContain('notif_notify_done_')
    expect(telegramRequests[0].createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    const notification = messages.find((message): message is { type: string; title: string; message: string; createdAt: string; notificationId: string; runId: string; stepId: string; channels: Array<{ kind: string }> } => Boolean(message) && typeof message === 'object' && (message as { type?: unknown }).type === 'macro_notification')
    expect(notification?.title).toBe('Done')
    expect(notification?.message).toBe('macro finished')
    expect(notification?.createdAt).toBe(telegramRequests[0].createdAt)
    expect(notification?.notificationId).toBe(telegramRequests[0].notificationId)
    expect(notification?.runId).toBe(telegramRequests[0].runId)
    expect(notification?.stepId).toBe('notify_done')
    expect(notification?.channels.map((channel) => channel.kind)).toEqual(['app', 'system'])
    const events = h.service.snapshot('local').run?.replay.events ?? []
    expect(events.some((event) => event.kind === 'notification_requested' && event.stepId === 'notify_done')).toBe(true)
    expect(events.some((event) => event.kind === 'notification_delivered' && event.stepId === 'notify_done' && (event.data as { channel?: { kind?: string } }).channel?.kind === 'telegram')).toBe(true)
    expect(JSON.stringify(events)).not.toContain('token')
    expect(JSON.stringify(events)).not.toContain('-100')
  } finally {
    h.cleanup()
  }
})

test('telegram transport failure is sanitized before run events are written', async () => {
  const h = harness((root) => {
    mkdirSync(join(root, '.shell-deck'), { recursive: true })
    writeFileSync(join(root, '.shell-deck', 'notification-profiles.json'), JSON.stringify({ telegram: { profiles: { default: { botToken: 'token-secret', channelId: '-10042' } } } }), 'utf8')
    return new NotificationService(root, async () => {
      throw new Error('fetch failed https://api.telegram.org/bottoken-secret/sendMessage chat -10042')
    })
  })
  try {
    h.templateStore.save('local', template('notify_sanitized_failure', [
      { id: 'notify_done', type: 'notify', level: 'error', title: 'Done', message: { parts: [{ kind: 'text', text: 'macro failed' }] }, channels: [{ kind: 'telegram', profileId: 'default' }], onFailure: 'continue' },
      { id: 'finish_done', type: 'finish', reason: 'done' },
    ]), h.manager.indexMap('local'))
    await h.service.start('local', { templateId: 'notify_sanitized_failure' })
    await waitFor(() => h.service.snapshot('local').status === 'completed')
    const events = h.service.snapshot('local').run?.replay.events ?? []
    const serialized = JSON.stringify(events)
    expect(events.some((event) => event.kind === 'notification_failed' && event.stepId === 'notify_done' && (event.data as { message?: string }).message === 'Telegram send failed')).toBe(true)
    expect(serialized).not.toContain('token-secret')
    expect(serialized).not.toContain('-10042')
    expect(serialized).not.toContain('api.telegram.org')
  } finally {
    h.cleanup()
  }
})

test('notify telegram failure can pause run', async () => {
  const dispatcher: NotificationDispatcher = {
    async sendTelegram(request): Promise<TelegramNotificationResult> {
      return { ok: false, profileId: request.profileId, code: 'profile_missing', message: 'missing' }
    },
  }
  const h = harness(dispatcher)
  try {
    h.templateStore.save('local', template('notify_pause', [
      { id: 'notify_done', type: 'notify', level: 'error', title: 'Done', message: { parts: [{ kind: 'text', text: 'macro failed' }] }, channels: [{ kind: 'telegram', profileId: 'default' }], onFailure: 'pause' },
      { id: 'finish_done', type: 'finish', reason: 'done' },
    ]), h.manager.indexMap('local'))
    await h.service.start('local', { templateId: 'notify_pause' })
    await waitFor(() => h.service.snapshot('local').status === 'paused')
    const snapshot = h.service.snapshot('local')
    expect(snapshot.pauseReason?.code).toBe('notification_failed')
    expect(snapshot.currentStepId).toBe('notify_done')
    const events = snapshot.run?.replay.events ?? []
    expect(events.some((event) => event.kind === 'notification_failed' && event.stepId === 'notify_done')).toBe(true)
    expect(events.some((event) => event.kind === 'step_completed' && event.stepId === 'notify_done')).toBe(false)
  } finally {
    h.cleanup()
  }
})

async function waitFor(predicate: () => boolean, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await Bun.sleep(20)
  }
  throw new Error('condition_timeout')
}
