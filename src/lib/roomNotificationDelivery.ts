import type { MacroNotificationMessage, MacroNotificationSound } from './protocol'

type RoomNotificationDeliveryOptions = {
  volume(): number
  notice(text: string, options: RoomNotificationNoticeOptions): void
}

export type RoomNotificationNoticeOptions = {
  title?: string
  level?: MacroNotificationMessage['level']
  createdAt?: string
  notificationId?: string
  runId?: string
  stepId?: string
  systemStatus?: string
}

const NOTIFICATION_MAX_GAIN = 0.12

export class RoomNotificationDelivery {
  readonly #options: RoomNotificationDeliveryOptions
  readonly #seen = new Set<string>()
  readonly #seenOrder: string[] = []
  readonly #repeatTimers = new Set<ReturnType<typeof setTimeout>>()

  constructor(options: RoomNotificationDeliveryOptions) {
    this.#options = options
  }

  async deliver(message: MacroNotificationMessage): Promise<void> {
    const notificationKey = message.roomGeneration + ':' + message.notificationId + ':' + message.channels.map((channel) => channel.kind).sort().join(',')
    if (this.#seen.has(notificationKey)) return
    this.#seen.add(notificationKey)
    this.#seenOrder.push(notificationKey)
    if (this.#seenOrder.length > 500) this.#seen.delete(this.#seenOrder.shift()!)
    const app = message.channels.find((channel) => channel.kind === 'app')
    const toast = app?.kind === 'app' && app.toast
    const options = { title: message.title, level: message.level, createdAt: message.createdAt, notificationId: message.notificationId, runId: message.runId, stepId: message.stepId }
    if (app?.kind === 'app' && (toast || app.sound !== 'none')) {
      this.#presentApp(message, app, options)
      for (let attempt = 1; attempt < app.repeatCount; attempt += 1) {
        const timer = setTimeout(() => {
          this.#repeatTimers.delete(timer)
          this.#presentApp(message, app, options)
        }, attempt * app.repeatIntervalMs)
        this.#repeatTimers.add(timer)
      }
    }
    if (message.channels.some((channel) => channel.kind === 'system')) {
      const status = await this.#showSystemNotification(message)
      if (status !== 'delivered' && !toast) this.#options.notice('System notification was not delivered.', { ...options, systemStatus: status })
    }
  }

  async playSound(sound: Exclude<MacroNotificationSound, 'none'>, level: MacroNotificationMessage['level']): Promise<void> {
    try {
      const AudioContextCtor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!AudioContextCtor) return
      const context = new AudioContextCtor()
      let cursor = context.currentTime
      for (const tone of notificationTones(sound, level)) {
        const oscillator = context.createOscillator()
        const gain = context.createGain()
        oscillator.type = tone.type
        oscillator.frequency.value = tone.frequency
        gain.gain.value = Math.min(NOTIFICATION_MAX_GAIN, tone.gain * this.#options.volume())
        oscillator.connect(gain)
        gain.connect(context.destination)
        oscillator.start(cursor)
        oscillator.stop(cursor + tone.duration)
        cursor += tone.duration + tone.gap
      }
      window.setTimeout(() => void context.close(), Math.ceil((cursor - context.currentTime + 0.05) * 1000))
    } catch { /* Browser audio is best effort. */ }
  }

  clear(): void {
    for (const timer of this.#repeatTimers) clearTimeout(timer)
    this.#repeatTimers.clear()
    this.#seen.clear()
    this.#seenOrder.splice(0)
  }

  #presentApp(
    message: MacroNotificationMessage,
    app: Extract<MacroNotificationMessage['channels'][number], { kind: 'app' }>,
    options: RoomNotificationNoticeOptions,
  ): void {
    if (app.toast) this.#options.notice(message.message || message.title, options)
    if (app.sound !== 'none') void this.playSound(app.sound, message.level)
  }

  async #showSystemNotification(message: MacroNotificationMessage): Promise<string> {
    if (!('Notification' in window)) return 'unavailable'
    let permission = Notification.permission
    if (permission === 'default') {
      try { permission = await Notification.requestPermission() }
      catch { return 'permission-request-failed' }
    }
    if (permission !== 'granted') return 'permission-' + permission
    try { new Notification(message.title, { body: message.message, tag: message.notificationId }); return 'delivered' }
    catch { return 'failed' }
  }
}

function notificationTones(sound: Exclude<MacroNotificationSound, 'none'>, level: MacroNotificationMessage['level']) {
  const base = level === 'error' ? 220 : level === 'warning' ? 330 : 660
  const tone = (frequency: number, duration = 0.09, gap = 0.02, gain = 0.04, type: OscillatorType = 'sine') => ({ frequency, duration, gap, gain, type })
  if (sound === 'success') return [tone(523, 0.07, 0.018, 0.036, 'triangle'), tone(659, 0.07, 0.018, 0.036, 'triangle'), tone(784, 0.12, 0.02, 0.034, 'triangle')]
  if (sound === 'warning') return [tone(440, 0.12, 0.04, 0.045, 'square'), tone(330, 0.15, 0.02, 0.04, 'square')]
  if (sound === 'alert') return [tone(880, 0.08, 0.025, 0.05, 'sawtooth'), tone(440, 0.1, 0.025, 0.045, 'sawtooth'), tone(880, 0.12, 0.02, 0.045, 'sawtooth')]
  if (sound === 'chime') return [tone(523), tone(784, 0.13)]
  if (sound === 'ping') return [tone(1175, 0.07), tone(1568, 0.08)]
  if (sound === 'pulse') return [tone(base, 0.1, 0.035), tone(base, 0.1)]
  return [tone(880, 0.08, 0.02, 0.045, 'triangle'), tone(660, 0.11, 0.02, 0.035, 'triangle')]
}
