import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import encodeQR, { Bitmap } from 'qr'
import {
  formatLoginTokenForTerminal,
  selectLoginQrMask,
} from '../../server/loginTokenPresentation'
import {
  LIVE_QR_MAX_FRAME_EDGE,
  LIVE_QR_MIN_START_INTERVAL_MS,
  liveQrCameraUnavailableMessage,
  liveQrFrameSize,
  nextLiveQrScanDelayMs,
  startLiveQrFrameLoop,
  type LiveQrTimer,
} from '../../src/lib/loginQrCamera'
import { decodeLoginTokenImage, decodeLoginTokenPhoto } from '../../src/lib/loginQrDecoder'
import {
  LOGIN_QR_ASSET_PATH,
  LOGIN_STYLE_ASSET_PATH,
  LOGIN_TOKEN_BYTES,
  LOGIN_TOKEN_LENGTH,
  isLoginToken,
} from '../../src/lib/loginToken'

const TOKEN = 'AbCdEfGhIjKlMnOpQrStUvWxYz_12345'

test('login token format has one shared exact contract', () => {
  expect(LOGIN_TOKEN_BYTES).toBe(24)
  expect(LOGIN_TOKEN_LENGTH).toBe(32)
  expect(LOGIN_QR_ASSET_PATH).toBe('/login-assets/login-qr.js')
  expect(LOGIN_STYLE_ASSET_PATH).toBe('/login-assets/login.css')
  expect(isLoginToken(TOKEN)).toBe(true)
  expect(isLoginToken(TOKEN.slice(1))).toBe(false)
  expect(isLoginToken(TOKEN + '=')).toBe(false)
  expect(isLoginToken('a'.repeat(31) + '!')).toBe(false)
})

test('QR decoder accepts only an exact shell-deck token payload', () => {
  expect(decodeLoginTokenImage(qrImage(TOKEN))).toBe(TOKEN)
  expect(decodeLoginTokenPhoto(landscapeQrImage(TOKEN))).toBe(TOKEN)
  expect(() => decodeLoginTokenImage(qrImage('https://example.invalid/'))).toThrow('login_qr_payload_invalid')
  expect(() => decodeLoginTokenPhoto(landscapeQrImage('https://example.invalid/')))
    .toThrow('login_qr_payload_invalid')
  expect(() => decodeLoginTokenImage({
    width: 8,
    height: 8,
    data: new Uint8ClampedArray(8 * 8 * 4).fill(255),
  })).toThrow('login_qr_not_found')
})

test('terminal presentation keeps the manual token and adds a terminal QR', () => {
  const mask = selectLoginQrMask(TOKEN)
  const presentation = formatLoginTokenForTerminal(TOKEN)
  expect(presentation).toContain('shell-deck login token: ' + TOKEN)
  expect(presentation).toContain('shell-deck login QR:')
  expect(presentation).toContain(encodeQR(TOKEN, 'term', {
    border: 4,
    ecc: 'quartile',
    mask,
  }))
  expect(presentation).toContain('\u001b[40m')
  expect(presentation).toContain('\u001b[1;47m')
  const terminalQrWidth = Math.max(...presentation.split('\n').slice(2)
    .map((line) => line.replace(/\u001b\[[0-9;]*m/g, '').length))
  expect(terminalQrWidth).toBeLessThanOrEqual(80)
  expect(() => formatLoginTokenForTerminal('wrong')).toThrow('invalid_login_token')
})

test('terminal QR mask selection round-trips difficult and deterministic token samples', () => {
  const samples = [
    'FvDxdoZsmSB6uJEAVseK604CoOieEuVO',
    'NWs-KMzkV4In9Yo5x0DWmzwutCUaOQXF',
    'xZH3gj2zxkdPAXY4blvO1I27qk99V7aV',
    ...Array.from({ length: 256 }, (_, index) =>
      createHash('sha256').update('shell-deck-login-qr-' + index).digest('base64url').slice(0, 32)),
  ]
  for (const token of samples) {
    const mask = selectLoginQrMask(token)
    for (const scale of [2, 3, 4]) {
      expect(decodeLoginTokenImage(qrImage(token, { mask, scale }))).toBe(token)
    }
  }
}, 15_000)

test('live camera frames and adaptive scan cadence have bounded work', () => {
  expect(LIVE_QR_MAX_FRAME_EDGE).toBe(720)
  expect(LIVE_QR_MIN_START_INTERVAL_MS).toBe(125)
  expect(liveQrFrameSize(1920, 1080)).toEqual({ width: 720, height: 405 })
  expect(liveQrFrameSize(360, 640)).toEqual({ width: 360, height: 640 })
  expect(nextLiveQrScanDelayMs(10)).toBe(115)
  expect(nextLiveQrScanDelayMs(80)).toBe(160)
  expect(nextLiveQrScanDelayMs(120)).toBe(240)
  expect(() => liveQrFrameSize(0, 720)).toThrow('login_qr_camera_frame_invalid')
  expect(liveQrCameraUnavailableMessage(false, true, true))
    .toBe('Live camera scanning requires HTTPS or localhost.')
  expect(liveQrCameraUnavailableMessage(true, false, true))
    .toBe('Live camera scanning is not supported by this browser.')
  expect(liveQrCameraUnavailableMessage(true, true, true)).toBeNull()
})

test('live scan loop never overlaps frame work and keeps one pending timer', async () => {
  let now = 0
  let nextHandle = 1
  const scheduled = new Map<number, { callback: () => void; delayMs: number }>()
  const timer: LiveQrTimer = {
    now: () => now,
    schedule(callback, delayMs) {
      const handle = nextHandle++
      scheduled.set(handle, { callback, delayMs })
      return handle
    },
    cancel(handle) {
      scheduled.delete(handle)
    },
  }
  let releaseFirst!: () => void
  const firstPending = new Promise<void>((resolve) => { releaseFirst = resolve })
  let scans = 0
  let active = 0
  let maxActive = 0
  const stop = startLiveQrFrameLoop(async () => {
    scans += 1
    active += 1
    maxActive = Math.max(maxActive, active)
    if (scans === 1) {
      now = 80
      await firstPending
    }
    active -= 1
  }, () => { throw new Error('unexpected_live_qr_failure') }, timer)

  expect(scheduled.size).toBe(1)
  takeScheduled(scheduled).callback()
  await Promise.resolve()
  expect({ scans, active, pending: scheduled.size }).toEqual({ scans: 1, active: 1, pending: 0 })
  releaseFirst()
  await firstPending
  await Promise.resolve()
  expect(maxActive).toBe(1)
  expect(scheduled.size).toBe(1)
  expect([...scheduled.values()][0]?.delayMs).toBe(160)
  stop()
  expect(scheduled.size).toBe(0)
})

function qrImage(
  payload: string,
  options: { mask?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7; scale?: number } = {},
) {
  const pixels = encodeQR(payload, 'raw', {
    border: 4,
    ecc: 'quartile',
    mask: options.mask,
    scale: options.scale ?? 6,
  })
  return new Bitmap({ width: pixels[0].length, height: pixels.length }, pixels).toImage()
}

function landscapeQrImage(payload: string) {
  const modules = encodeQR(payload, 'raw', { border: 4, ecc: 'quartile' })
  const scale = 4
  const qrSize = modules.length * scale
  const width = qrSize + 240
  const height = qrSize + 80
  const data = new Uint8ClampedArray(width * height * 4).fill(245)
  for (let index = 3; index < data.length; index += 4) data[index] = 255
  const offsetX = Math.floor((width - qrSize) / 2)
  const offsetY = Math.floor((height - qrSize) / 2)
  for (let moduleY = 0; moduleY < modules.length; moduleY += 1) {
    for (let moduleX = 0; moduleX < modules.length; moduleX += 1) {
      const value = modules[moduleY]![moduleX] ? 0 : 255
      for (let y = 0; y < scale; y += 1) for (let x = 0; x < scale; x += 1) {
        const pixel = ((offsetY + moduleY * scale + y) * width + offsetX + moduleX * scale + x) * 4
        data[pixel] = value
        data[pixel + 1] = value
        data[pixel + 2] = value
      }
    }
  }
  return { width, height, data }
}

function takeScheduled(
  scheduled: Map<number, { callback: () => void; delayMs: number }>,
): { callback: () => void; delayMs: number } {
  const entry = scheduled.entries().next().value
  if (!entry) throw new Error('missing_scheduled_callback')
  scheduled.delete(entry[0])
  return entry[1]
}
