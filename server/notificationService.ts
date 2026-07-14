import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { assertValidPublicId } from '../src/lib/identifier'
import { assertPrivateNotificationFile, resolveUserDataRoot } from './userDataRoot'

export type NotificationLevel = 'info' | 'success' | 'warning' | 'error'

export type NotificationMetadata = {
  notificationId?: string
  runId?: string
  stepId?: string
  createdAt?: string
}

export type TelegramNotificationRequest = NotificationMetadata & {
  profileId: string
  title: string
  message: string
  level: NotificationLevel
}


export type TelegramNotificationResult =
  | { ok: true; profileId: string; status: number }
  | { ok: false; profileId: string; code: string; message: string; status?: number }


type TelegramProfile = {
  botToken: string
  channelId: string
  disableWebPagePreview?: boolean
}

type NotificationProfilesFile = {
  telegram?: {
    profiles?: Record<string, TelegramProfile>
  }
}

type FetchLike = (input: string, init: RequestInit) => Promise<Response>
export type NotificationDispatcher = {
  sendTelegram(request: TelegramNotificationRequest): Promise<TelegramNotificationResult>
}

const TELEGRAM_MAX_MESSAGE_CHARS = 4096
const TELEGRAM_SAFE_MESSAGE_CHARS = 3900

export class NotificationService {
  constructor(
    readonly rootDir = resolveUserDataRoot(),
    private readonly fetcher: FetchLike = fetch,
    private readonly timeoutMs = 10000,
    readonly unavailableReason: string | null = null,
  ) {}

  profilesPath(): string {
    return notificationProfilesPath(this.rootDir)
  }

  listTelegramProfileIds(): string[] {
    this.assertAvailable()
    const configPath = this.profilesPath()
    assertPrivateNotificationFile(configPath)
    if (!existsSync(configPath)) return []
    const parsed = this.readProfilesFile()
    const profiles = parsed.telegram?.profiles
    if (!profiles || typeof profiles !== 'object' || Array.isArray(profiles)) return []
    return Object.keys(profiles).filter((profileId) => /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(profileId)).sort((a, b) => a.localeCompare(b))
  }

  readTelegramProfile(profileId: string): TelegramProfile | null {
    this.assertAvailable()
    const normalizedProfileId = assertValidPublicId(profileId)
    const configPath = this.profilesPath()
    assertPrivateNotificationFile(configPath)
    if (!existsSync(configPath)) return null
    const parsed = this.readProfilesFile()
    const profiles = parsed.telegram?.profiles
    if (!profiles || !Object.prototype.hasOwnProperty.call(profiles, normalizedProfileId)) return null
    const profile = profiles[normalizedProfileId]
    if (!profile) return null
    if (typeof profile.botToken !== 'string' || profile.botToken.length === 0) throw new Error('notification_telegram_bot_token_missing:' + normalizedProfileId)
    if (typeof profile.channelId !== 'string' || profile.channelId.length === 0) throw new Error('notification_telegram_channel_id_missing:' + normalizedProfileId)
    if (profile.disableWebPagePreview !== undefined && typeof profile.disableWebPagePreview !== 'boolean') throw new Error('notification_telegram_disable_preview_invalid:' + normalizedProfileId)
    return profile
  }

  private readProfilesFile(): NotificationProfilesFile {
    try {
      return JSON.parse(readFileSync(this.profilesPath(), 'utf8')) as NotificationProfilesFile
    } catch {
      throw new Error('notification_profiles_invalid_json')
    }
  }

  private assertAvailable(): void {
    if (this.unavailableReason) throw new Error(this.unavailableReason)
  }

  async sendTelegram(request: TelegramNotificationRequest): Promise<TelegramNotificationResult> {
    let profile: TelegramProfile | null
    try {
      profile = this.readTelegramProfile(request.profileId)
    } catch (error) {
      return { ok: false, profileId: request.profileId, code: 'profile_invalid', message: error instanceof Error ? error.message : String(error) }
    }
    if (!profile) return { ok: false, profileId: request.profileId, code: 'profile_missing', message: 'Telegram notification profile not found: ' + request.profileId }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const response = await this.fetcher('https://api.telegram.org/bot' + profile.botToken + '/sendMessage', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          chat_id: profile.channelId,
          text: telegramText(request.title, request.message, request),
          disable_web_page_preview: profile.disableWebPagePreview ?? true,
        }),
      })
      if (!response.ok) {
        return { ok: false, profileId: request.profileId, code: 'telegram_http_' + response.status, status: response.status, message: 'Telegram send failed with HTTP ' + response.status }
      }
      return { ok: true, profileId: request.profileId, status: response.status }
    } catch {
      const aborted = controller.signal.aborted
      return { ok: false, profileId: request.profileId, code: aborted ? 'telegram_timeout' : 'telegram_fetch_failed', message: aborted ? 'Telegram send timed out' : 'Telegram send failed' }
    } finally {
      clearTimeout(timer)
    }
  }

}

export function notificationProfilesPath(rootDir = resolveUserDataRoot()): string {
  return join(rootDir, 'notification-profiles.json')
}

export function telegramText(title: string, message: string, metadata: NotificationMetadata & { level?: NotificationLevel } = {}): string {
  const body = telegramFields(title, message, metadata).join('\n')
  if (body.length <= TELEGRAM_MAX_MESSAGE_CHARS) return body
  return body.slice(0, TELEGRAM_SAFE_MESSAGE_CHARS) + '\n\n[truncated]'
}

export function telegramFields(title: string, message: string, metadata: NotificationMetadata & { level?: NotificationLevel } = {}): string[] {
  const lines: string[] = []
  if (title.trim()) lines.push('title: ' + fieldValue(title.trim()))
  if (metadata.level) lines.push('level: ' + metadata.level)
  lines.push('message: ' + fieldValue(message))
  lines.push(...notificationDetails(metadata))
  return lines
}

function fieldValue(value: string): string {
  return value.replace(/\r\n/g, '\n').replace(/\n/g, '\\n')
}

export function notificationDetails(metadata: NotificationMetadata): string[] {
  const lines: string[] = []
  if (metadata.createdAt) lines.push('time: ' + metadata.createdAt)
  if (metadata.notificationId) lines.push('notification_id: ' + metadata.notificationId)
  if (metadata.runId) lines.push('run_id: ' + metadata.runId)
  if (metadata.stepId) lines.push('step_id: ' + metadata.stepId)
  return lines
}
