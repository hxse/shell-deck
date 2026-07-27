import { expect, test } from 'playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import encodeQR, { Bitmap } from 'qr'
import { startShellDeckServer, type ShellDeckServer } from '../../server/httpServer'
import { selectLoginQrMask } from '../../server/loginTokenPresentation'
import {
  LOGIN_QR_ASSET_PATH,
  LOGIN_STYLE_ASSET_PATH,
  isLoginToken,
} from '../../src/lib/loginToken'

let server: ShellDeckServer
let dataRoot: string

test.beforeAll(() => {
  dataRoot = mkdtempSync(join(tmpdir(), 'shell-deck-qr-login-'))
  server = startShellDeckServer({
    accessMode: 'authenticated',
    listenMode: 'local',
    port: 0,
    dataRoot,
  })
})

test.afterAll(async () => {
  await server.stop()
  rmSync(dataRoot, { recursive: true, force: true })
})

test('a captured token QR uses the existing login form and enters a Room', async ({ page }) => {
  await page.goto(server.url + '/login')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'business')
  await expect(page.locator('link[href="/login-assets/login.css"]')).toHaveCount(1)
  await expect(page.locator('#login-form')).toHaveClass(/grid/)
  await expect(page.locator('#login-token')).toHaveClass(/input/)
  await expect(page.getByRole('button', { name: 'Upload QR image' })).toBeVisible()
  await expect(page.locator('#upload-login-qr > #login-qr-file')).toBeVisible()
  await expect(page.locator('#login-qr-file')).toHaveClass(/file-input-ghost/)
  await expect(page.getByRole('button', { name: 'Scan with camera' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Scan with camera' })).toHaveClass(/btn-md/)
  await expect(page.getByRole('button', { name: 'Log in' })).toHaveClass(/btn-primary/)
  await expect(page.locator('#login-qr-status-shell')).toBeHidden()
  const loginAsset = await page.request.get(server.url + LOGIN_QR_ASSET_PATH)
  expect(loginAsset.status()).toBe(200)
  expect(loginAsset.headers()['cache-control']).toBe('no-store')
  const loginStyle = await page.request.get(server.url + LOGIN_STYLE_ASSET_PATH)
  expect(loginStyle.status()).toBe(200)
  expect(loginStyle.headers()['content-type']).toContain('text/css')
  expect(loginStyle.headers()['cache-control']).toBe('no-store')
  expect(await loginStyle.text()).toContain('.btn')
  const chooserPromise = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Upload QR image' }).click()
  const chooser = await chooserPromise
  await expect(page.locator('#login-qr-status')).toHaveText(
    'Choose or take a photo containing the terminal login QR code.',
  )
  await chooser.setFiles(qrFile(server.loginToken!))
  await expect(page).toHaveURL(authenticatedUrl(server.url))
  expect(await page.context().cookies(server.url)).toEqual(expect.arrayContaining([
    expect.objectContaining({ name: 'shell_deck_session', httpOnly: true, sameSite: 'Strict' }),
  ]))
})

test('Android capture input decodes a small terminal QR camera photo', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/140.0.0.0 Mobile Safari/537.36' }))
  await page.goto(server.url + '/login')
  await expect(page.locator('#take-login-qr-photo')).toBeVisible()
  await page.locator('#login-qr-capture-file').setInputFiles(
    await androidCameraPhotoFile(page, server.loginToken!),
  )
  await expect(page).toHaveURL(authenticatedUrl(server.url))
  expect(await page.context().cookies(server.url)).toEqual(expect.arrayContaining([
    expect.objectContaining({ name: 'shell_deck_session', httpOnly: true, sameSite: 'Strict' }),
  ]))
})

test('mobile input events submit a selected QR even without a change event', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0 (Android 14; Mobile; rv:153.0) Gecko/153.0 Firefox/153.0' }))
  await page.goto(server.url + '/login')
  await expect(page.locator('#take-login-qr-photo')).toBeVisible()
  await page.locator('#login-qr-file').evaluate((input) => {
    input.addEventListener('change', (event) => event.stopImmediatePropagation(), { capture: true })
  })
  await page.locator('#login-qr-file').setInputFiles(qrFile(server.loginToken!))
  await expect(page).toHaveURL(authenticatedUrl(server.url))
})
test('return probing consumes a File when mobile omits input and change events', async ({ page }) => {
  await page.goto(server.url + '/login')
  await page.locator('#login-qr-file').evaluate((input) => {
    for (const name of ['input', 'change']) {
      input.addEventListener(name, (event) => event.stopImmediatePropagation(), { capture: true })
    }
  })
  await page.locator('#login-qr-file').dispatchEvent('pointerdown')
  await page.locator('#login-qr-file').setInputFiles(qrFile(server.loginToken!))
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page).toHaveURL(authenticatedUrl(server.url))
})
test('pointer activation clears a browser-restored file selection before the picker opens', async ({ page }) => {
  await page.goto(server.url + '/login')
  await page.locator('#login-qr-file').evaluate((input: HTMLInputElement) => {
    const transfer = new DataTransfer()
    transfer.items.add(new File(['stale'], 'login-qr.png', { type: 'image/png' }))
    input.files = transfer.files
  })
  expect(await page.locator('#login-qr-file').evaluate((input: HTMLInputElement) => input.files?.length)).toBe(1)
  await page.locator('#login-qr-file').dispatchEvent('pointerdown')
  expect(await page.locator('#login-qr-file').evaluate((input: HTMLInputElement) => input.files?.length)).toBe(0)
})
test('opt-in diagnostics retain a safe picker trace across login-page reloads', async ({ page }) => {
  await page.goto(server.url + '/login#debug')
  await expect(page.locator('#login-debug-shell')).toBeVisible()
  await expect(page.locator('#login-debug-shell')).toHaveAttribute('open', '')
  await suppressFileChooserAndClickUpload(page)
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  await expect.poll(async () => await page.locator('#login-debug-output').inputValue()).toContain(
    'file_return_timeout',
  )
  const beforeReload = await page.locator('#login-debug-output').inputValue()
  expect(beforeReload).toContain('page_loaded')
  expect(beforeReload).toContain('file_click')
  expect(beforeReload).not.toContain(server.loginToken!)

  await page.reload()
  await expect(page.locator('#login-debug-shell')).toBeVisible()
  const afterReload = await page.locator('#login-debug-output').inputValue()
  expect(afterReload).toContain('file_return_timeout')
  expect(afterReload.match(/page_loaded/g)?.length).toBeGreaterThanOrEqual(2)
  expect(afterReload).not.toContain(server.loginToken!)
})

test('a stale browser session is replaced by QR login after server restart', async ({ page }) => {
  const restartRoot = mkdtempSync(join(tmpdir(), 'shell-deck-qr-restart-'))
  const first = startShellDeckServer({
    accessMode: 'authenticated',
    listenMode: 'local',
    port: 0,
    dataRoot: restartRoot,
  })
  let second: ShellDeckServer | null = null
  try {
    await page.goto(first.url + '/login')
    await page.locator('#login-qr-file').setInputFiles(qrFile(first.loginToken!))
    await expect(page).toHaveURL(authenticatedUrl(first.url))
    const roomPath = new URL(page.url()).pathname
    const firstSession = (await page.context().cookies(first.url))
      .find((cookie) => cookie.name === 'shell_deck_session')?.value
    expect(firstSession).toBeTruthy()

    await first.stop()
    second = startShellDeckServer({
      accessMode: 'authenticated',
      listenMode: 'local',
      port: first.port,
      dataRoot: restartRoot,
    })
    expect(second.loginToken).not.toBe(first.loginToken)

    await page.reload()
    await expect(page.locator('#login-form')).toBeVisible()
    await expect(page.locator('input[name="next"]')).toHaveValue(roomPath)
    await page.locator('#login-qr-file').setInputFiles(qrFile(second.loginToken!))
    await expect(page).toHaveURL(second.url + roomPath)
    const secondSession = (await page.context().cookies(second.url))
      .find((cookie) => cookie.name === 'shell_deck_session')?.value
    expect(secondSession).toBeTruthy()
    expect(secondSession).not.toBe(firstSession)
  } finally {
    await (second ?? first).stop()
    rmSync(restartRoot, { recursive: true, force: true })
  }
})
test('a readable non-token QR stays on login and does not submit', async ({ page }) => {
  await page.goto(server.url + '/login')
  await page.locator('#login-qr-file').setInputFiles(qrFile('https://example.invalid/'))
  await expect(page.locator('#login-qr-status')).toHaveText('The QR code is not a shell-deck login token.')
  await expect(page.locator('#login-qr-status')).toBeVisible()
  await expect(page.locator('#login-qr-status')).toHaveClass(/alert-error/)
  await expect(page.locator('#login-token')).toHaveValue('')
  await expect(page).toHaveURL(server.url + '/login')
})
test('a camera handoff without a photo reports the failure in the fixed status', async ({ page }) => {
  await page.goto(server.url + '/login')
  await suppressFileChooserAndClickUpload(page)
  await expect(page.locator('#login-qr-status')).toHaveText(
    'Choose or take a photo containing the terminal login QR code.',
  )
  await page.locator('#login-qr-file').dispatchEvent('cancel')
  await expect(page.locator('#login-qr-status')).toHaveText(
    'No photo was selected or returned by the camera.',
  )
  await expect(page.locator('#login-qr-status-shell')).toBeVisible()
  await expect(page.locator('#login-qr-status')).toHaveClass(/alert-error/)
})
test('a camera handoff that emits neither file nor cancel fails when the page becomes visible', async ({ page }) => {
  await page.goto(server.url + '/login')
  await suppressFileChooserAndClickUpload(page)
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  await expect(page.locator('#login-qr-status')).toHaveText(
    'The picker returned without a photo. Choose an existing image from Photos or files.',
  )
  await expect(page.locator('#login-qr-status-shell')).toBeVisible()
})

test('a page reload during external camera handoff restores an actionable error', async ({ page }) => {
  await page.goto(server.url + '/login')
  await suppressFileChooserAndClickUpload(page)
  await page.reload()
  await expect(page.locator('#login-qr-status')).toHaveText(
    'The login page reloaded before the camera returned a photo. Take the photo first, then choose it from Photos or files.',
  )
  await expect(page.locator('#login-qr-status-shell')).toBeVisible()
})

test('a photo without a QR shows actionable visible feedback', async ({ page }) => {
  await page.goto(server.url + '/login')
  await page.locator('#login-qr-file').setInputFiles(blankImageFile())
  await expect(page.locator('#login-qr-status')).toHaveText(
    'No QR code was found. Keep the whole QR and its white border in frame, avoid glare, and try again.',
  )
  await expect(page.locator('#login-qr-status')).toBeVisible()
  await expect(page).toHaveURL(server.url + '/login')
})

test('a live camera token QR logs in with bounded local scanning and stops the track', async ({ page }) => {
  await installFakeCamera(page, server.loginToken!)
  await page.goto(server.url + '/login')
  await page.getByRole('button', { name: 'Scan with camera' }).click()
  await expect(page).toHaveURL(authenticatedUrl(server.url))
  expect(await page.context().cookies(server.url)).toEqual(expect.arrayContaining([
    expect.objectContaining({ name: 'shell_deck_session', httpOnly: true, sameSite: 'Strict' }),
  ]))
  expect(JSON.parse(await page.evaluate(() =>
    sessionStorage.getItem('shell-deck-test-camera-constraints') ?? 'null',
  ))).toEqual({
    audio: false,
    video: {
      facingMode: { ideal: 'environment' },
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 15, max: 30 },
    },
  })
  expect(await page.evaluate(() => sessionStorage.getItem('shell-deck-test-camera-stops'))).toBe('1')
})

test('cancelling live scan stops its camera without submitting a non-token QR', async ({ page }) => {
  await installFakeCamera(page, 'https://example.invalid/')
  await page.goto(server.url + '/login')
  await page.getByRole('button', { name: 'Scan with camera' }).click()
  await expect(page.locator('#login-qr-camera-status')).toHaveText('The QR code is not a shell-deck login token.')
  await expect(page.locator('#login-qr-camera-status')).toBeVisible()
  await page.getByRole('button', { name: 'Cancel camera' }).click()
  await expect(page.getByRole('dialog', { name: 'Scan login QR' })).not.toBeVisible()
  await expect(page).toHaveURL(server.url + '/login')
  expect(await page.evaluate(() => sessionStorage.getItem('shell-deck-test-camera-stops'))).toBe('1')
})

test('cancelling while camera permission is pending rejects the late stream', async ({ page }) => {
  await installFakeCamera(page, server.loginToken!, 1_000)
  await page.goto(server.url + '/login')
  await page.getByRole('button', { name: 'Scan with camera' }).click()
  await expect(page.getByRole('dialog', { name: 'Scan login QR' })).toBeVisible()
  await page.getByRole('button', { name: 'Cancel camera' }).click()
  await expect(page.getByRole('dialog', { name: 'Scan login QR' })).not.toBeVisible()
  await expect.poll(() => page.evaluate(() =>
    sessionStorage.getItem('shell-deck-test-camera-stops'),
  )).toBe('1')
  await expect(page).toHaveURL(server.url + '/login')
})

test('leaving the login page lifecycle stops an active camera stream', async ({ page }) => {
  await installFakeCamera(page, 'https://example.invalid/')
  await page.goto(server.url + '/login')
  await page.getByRole('button', { name: 'Scan with camera' }).click()
  await expect(page.locator('#login-qr-camera-status')).toHaveText('The QR code is not a shell-deck login token.')
  await expect(page.locator('#login-qr-camera-status')).toBeVisible()
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')))
  await expect(page.getByRole('dialog', { name: 'Scan login QR' })).not.toBeVisible()
  expect(await page.evaluate(() => sessionStorage.getItem('shell-deck-test-camera-stops'))).toBe('1')
})

function qrFile(payload: string) {
  return {
    name: 'shell-deck-token.gif',
    mimeType: 'image/gif',
    buffer: Buffer.from(encodeQR(payload, 'gif', qrOptions(payload, 8))),
  }
}

function blankImageFile() {
  return {
    name: 'photo-without-qr.gif',
    mimeType: 'image/gif',
    buffer: Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64'),
  }
}

async function androidCameraPhotoFile(
  page: import('playwright/test').Page,
  payload: string,
) {
  const modules = encodeQR(payload, 'raw', qrOptions(payload, 4))
  const image = new Bitmap({ width: modules[0].length, height: modules.length }, modules).toImage()
  const bytes = await page.evaluate(async ({ width, height, pixels }) => {
    const photo = document.createElement('canvas')
    photo.width = 4000
    photo.height = 3000
    const context = photo.getContext('2d')!
    context.fillStyle = '#111827'
    context.fillRect(0, 0, photo.width, photo.height)
    const qr = document.createElement('canvas')
    qr.width = width
    qr.height = height
    qr.getContext('2d')!.putImageData(
      new ImageData(new Uint8ClampedArray(pixels), width, height),
      0,
      0,
    )
    context.save()
    context.translate(photo.width / 2, photo.height / 2)
    context.rotate(0.018)
    context.drawImage(qr, -width / 2, -height / 2)
    context.restore()
    const blob = await new Promise<Blob>((resolve, reject) => {
      photo.toBlob((value) => value ? resolve(value) : reject(new Error('jpeg_encode_failed')), 'image/jpeg', 0.72)
    })
    return Array.from(new Uint8Array(await blob.arrayBuffer()))
  }, { width: image.width, height: image.height, pixels: Array.from(image.data) })
  return {
    name: 'android-camera-photo.jpg',
    mimeType: 'image/jpeg',
    buffer: Buffer.from(bytes),
  }
}

async function installFakeCamera(
  page: import('playwright/test').Page,
  payload: string,
  startDelayMs = 0,
): Promise<void> {
  const modules = encodeQR(payload, 'raw', qrOptions(payload, 6))
  const image = new Bitmap({ width: modules[0].length, height: modules.length }, modules).toImage()
  await page.addInitScript(({ width, height, pixels, delayMs }) => {
    const devices = Object.create(navigator.mediaDevices ?? null) as MediaDevices
    Object.defineProperty(devices, 'getUserMedia', {
      configurable: true,
      value: async (constraints: MediaStreamConstraints) => {
        sessionStorage.setItem('shell-deck-test-camera-constraints', JSON.stringify(constraints))
        if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs))
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const context = canvas.getContext('2d')
        if (!context) throw new Error('fake_camera_canvas_unavailable')
        context.putImageData(new ImageData(new Uint8ClampedArray(pixels), width, height), 0, 0)
        const stream = canvas.captureStream(10)
        for (const track of stream.getTracks()) {
          const stop = track.stop.bind(track)
          track.stop = () => {
            const count = Number(sessionStorage.getItem('shell-deck-test-camera-stops') ?? '0')
            sessionStorage.setItem('shell-deck-test-camera-stops', String(count + 1))
            stop()
          }
        }
        return stream
      },
    })
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: devices })
  }, { width: image.width, height: image.height, pixels: Array.from(image.data), delayMs: startDelayMs })
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function authenticatedUrl(serverUrl: string): RegExp {
  return new RegExp('^' + escapeRegex(serverUrl) + '/(?:room_[A-Za-z0-9_-]+)?$')
}

function qrOptions(payload: string, scale: number) {
  return isLoginToken(payload)
    ? { border: 4, ecc: 'quartile' as const, mask: selectLoginQrMask(payload), scale }
    : { border: 4, ecc: 'high' as const, scale }
}

async function suppressFileChooserAndClickUpload(
  page: import('playwright/test').Page,
): Promise<void> {
  await page.evaluate(() => {
    const input = document.getElementById('login-qr-file') as HTMLInputElement
    input.addEventListener('click', (event) => event.preventDefault(), { once: true })
    input.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })
}
