import { decodeLoginTokenPhoto } from './lib/loginQrDecoder'
import { LoginQrCameraScanner } from './lib/loginQrCamera'
import { LoginQrDiagnostics } from './lib/loginQrDiagnostics'
import { LoginQrFileReturnProbe } from './lib/loginQrFileReturnProbe'

const MAX_IMAGE_BYTES = 20 * 1024 * 1024
const MAX_IMAGE_EDGE = 1600
const RETRY_IMAGE_EDGE = 1200
const PHOTO_CROP_FACTORS = [1, 0.72, 0.48] as const
const PHOTO_HANDOFF_KEY = 'shell-deck-login-photo-handoff'
const PHOTO_HANDOFF_TTL_MS = 10 * 60 * 1000

const form = requiredElement('login-form', HTMLFormElement)
const tokenInput = requiredElement('login-token', HTMLInputElement)
const uploadButton = requiredElement('upload-login-qr', HTMLElement)
const cameraButton = requiredElement('scan-login-qr-live', HTMLButtonElement)
const cameraCloseButton = requiredElement('close-login-qr-camera', HTMLButtonElement)
const cameraDialog = requiredElement('login-qr-camera-dialog', HTMLElement) as HTMLDialogElement
const cameraVideo = requiredElement('login-qr-camera-video', HTMLVideoElement)
const fileInput = requiredElement('login-qr-file', HTMLInputElement)
const captureInput = requiredElement('login-qr-capture-file', HTMLInputElement)
const captureShell = requiredElement('take-login-qr-photo', HTMLElement)
const status = requiredElement('login-qr-status', HTMLElement)
const statusShell = requiredElement('login-qr-status-shell', HTMLElement)
const cameraStatus = requiredElement('login-qr-camera-status', HTMLElement)
const diagnostics = new LoginQrDiagnostics()
const isAndroid = navigator.userAgent.includes('Android')
if (isAndroid) captureShell.classList.remove('hidden')
let waitingForFile = false
let activeUploadFile: File | null = null
let returnedFromHidden = false
const fileReturnProbe = new LoginQrFileReturnProbe(fileInput, {
  onFile: () => consumePhotoSelection('return-probe'),
  onTimeout: () => {
    waitingForFile = false
    clearPhotoHandoff()
    diagnostics.event('file_return_timeout')
    showStatus('The picker returned without a photo. Choose an existing image from Photos or files.', true)
  },
  onEvent: (name, details) => diagnostics.event(name, details),
})

const cameraScanner = new LoginQrCameraScanner(
  { dialog: cameraDialog, video: cameraVideo },
  {
    onStatus: showStatus,
    onToken: submitToken,
  },
)
restoreInterruptedPhotoHandoff()
resetNativeFileInput()

uploadButton.addEventListener('pointerdown', () => prepareFileHandoff('pointerdown'))
uploadButton.addEventListener('touchstart', () => prepareFileHandoff('touchstart'), { passive: true })

uploadButton.addEventListener('keydown', (event) => {
  if (fileInput.disabled || (event.key !== 'Enter' && event.key !== ' ')) return
  prepareFileHandoff('keydown')
})

fileInput.addEventListener('click', (event) => {
  diagnostics.event('file_click', { disabled: fileInput.disabled, waitingForFile })
  if (fileInput.disabled) {
    event.preventDefault()
    return
  }
  beginPhotoHandoff()
})
fileInput.addEventListener('focus', () => diagnostics.event('file_focus', { files: fileInput.files?.length }))

cameraButton.addEventListener('click', () => void cameraScanner.start())

cameraCloseButton.addEventListener('click', () => {
  cameraScanner.stop()
  showStatus('Live camera scanning cancelled.')
})

cameraDialog.addEventListener('cancel', (event) => {
  event.preventDefault()
  cameraScanner.stop()
  showStatus('Live camera scanning cancelled.')
})

fileInput.addEventListener('cancel', () => {
  diagnostics.event('file_cancel', { files: fileInput.files?.length })
  waitingForFile = false
  fileReturnProbe.cancel()
  clearPhotoHandoff()
  showStatus('No photo was selected or returned by the camera.', true)
})

fileInput.addEventListener('input', () => consumePhotoSelection('input'))
fileInput.addEventListener('change', () => consumePhotoSelection('change'))
captureInput.addEventListener('pointerdown', () => {
  captureInput.value = ''
})
captureInput.addEventListener('click', () => {
  diagnostics.event('capture_click')
  markPhotoHandoff()
  showStatus('Take a photo containing the terminal login QR code.')
})
captureInput.addEventListener('cancel', () => {
  clearPhotoHandoff()
  showStatus('No photo was taken.', true)
})
captureInput.addEventListener('input', () => consumePhotoSelection('capture-input', captureInput))
captureInput.addEventListener('change', () => consumePhotoSelection('capture-change', captureInput))

function consumePhotoSelection(
  event: 'input' | 'change' | 'return-probe' | 'capture-input' | 'capture-change',
  input = fileInput,
): void {
  waitingForFile = false
  fileReturnProbe.cancel()
  clearPhotoHandoff()
  const file = input.files?.[0]
  diagnostics.event('file_selection', {
    event,
    source: input === captureInput ? 'capture' : 'picker',
    files: input.files?.length,
    type: file?.type || '(empty)',
    size: file?.size,
    lastModified: file?.lastModified,
  })
  if (!file) {
    showStatus('No photo was selected or returned by the camera.', true)
    return
  }
  if (file === activeUploadFile) return
  activeUploadFile = file
  void scan(file, input).finally(() => {
    if (activeUploadFile === file) activeUploadFile = null
  })
}

form.addEventListener('submit', () => {
  diagnostics.event('form_submit', { tokenLength: tokenInput.value.length })
  cameraScanner.stop()
})
window.addEventListener('focus', () => {
  diagnostics.event('window_focus', { waitingForFile })
  if (returnedFromHidden) fileReturnProbe.returned()
})
window.addEventListener('pageshow', (event) => {
  diagnostics.event('page_show', { persisted: event.persisted })
  if (event.persisted) resetNativeFileInput()
})
window.addEventListener('pagehide', () => cameraScanner.stop())
document.addEventListener('visibilitychange', () => {
  diagnostics.event('visibility_change', { state: document.visibilityState, waitingForFile })
  if (document.hidden) {
    returnedFromHidden = true
    cameraScanner.stop()
  } else {
    const forceProbe = returnedFromHidden || waitingForFile
    returnedFromHidden = false
    if (forceProbe) fileReturnProbe.returned()
  }
})

async function scan(file: File, sourceInput: HTMLInputElement): Promise<void> {
  diagnostics.event('scan_start', { type: file.type || '(empty)', size: file.size })
  setPhotoInputsBusy(true)
  showStatus('Photo received. Reading image pixels…')
  try {
    assertImageFile(file)
    const image = await createPhotoBitmap(file)
    diagnostics.event('bitmap_ready', { width: image.width, height: image.height })
    try {
      submitToken(await decodePhoto(image))
    } finally {
      image.close()
    }
  } catch (error) {
    diagnostics.event('scan_failed', { code: error instanceof Error ? error.message : 'unknown_error' })
    showStatus(loginQrErrorMessage(error), true)
  } finally {
    setPhotoInputsBusy(false)
    sourceInput.value = ''
  }
}

function setPhotoInputsBusy(busy: boolean): void {
  for (const input of [fileInput, captureInput]) {
    input.disabled = busy
    input.toggleAttribute('aria-busy', busy)
  }
}

async function decodePhoto(image: ImageBitmap): Promise<string> {
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('login_qr_canvas_unavailable')
  let sawInvalidPayload = false
  for (const [index, factor] of PHOTO_CROP_FACTORS.entries()) {
    showStatus(`Scanning photo… pass ${index + 1} of ${PHOTO_CROP_FACTORS.length}.`)
    await nextPaint()
    const region = photoRegion(image.width, image.height, factor)
    const { width, height } = scaledSize(
      region.width,
      region.height,
      index === 0 ? MAX_IMAGE_EDGE : RETRY_IMAGE_EDGE,
    )
    diagnostics.event('decode_pass', { pass: index + 1, crop: factor, width, height })
    canvas.width = width
    canvas.height = height
    context.drawImage(
      image,
      region.x,
      region.y,
      region.width,
      region.height,
      0,
      0,
      width,
      height,
    )
    try {
      const token = decodeLoginTokenPhoto(context.getImageData(0, 0, width, height))
      diagnostics.event('decode_succeeded', { pass: index + 1, tokenLength: token.length })
      return token
    } catch (error) {
      diagnostics.event('decode_rejected', {
        pass: index + 1,
        code: error instanceof Error ? error.message : 'unknown_error',
      })
      if (error instanceof Error && error.message === 'login_qr_payload_invalid') {
        sawInvalidPayload = true
      } else if (!(error instanceof Error) || error.message !== 'login_qr_not_found') {
        throw error
      }
    }
  }
  throw new Error(sawInvalidPayload ? 'login_qr_payload_invalid' : 'login_qr_not_found')
}

function submitToken(token: string): void {
  diagnostics.event('token_accepted', { tokenLength: token.length })
  tokenInput.value = token
  showStatus('Token scanned. Logging in…')
  form.requestSubmit()
}

function assertImageFile(file: File): void {
  if (file.type && !file.type.startsWith('image/')) throw new Error('login_qr_file_not_image')
  if (file.size > MAX_IMAGE_BYTES) throw new Error('login_qr_file_too_large')
}

async function createPhotoBitmap(file: File): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    diagnostics.event('bitmap_orientation_fallback')
    try {
      return await createImageBitmap(file)
    } catch {
      throw new Error('login_qr_image_decode_failed')
    }
  }
}

function scaledSize(width: number, height: number, maxEdge: number): { width: number; height: number } {
  if (width < 1 || height < 1) throw new Error('login_qr_image_invalid')
  const scale = Math.min(1, maxEdge / Math.max(width, height))
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

function photoRegion(width: number, height: number, factor: number) {
  if (factor === 1) return { x: 0, y: 0, width, height }
  const size = Math.max(1, Math.round(Math.min(width, height) * factor))
  return {
    x: Math.floor((width - size) / 2),
    y: Math.floor((height - size) / 2),
    width: size,
    height: size,
  }
}

function nextPaint(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

function loginQrErrorMessage(error: unknown): string {
  const code = error instanceof Error ? error.message : ''
  if (code === 'login_qr_payload_invalid') return 'The QR code is not a shell-deck login token.'
  if (code === 'login_qr_file_too_large') return 'The image is larger than 20 MiB.'
  if (code === 'login_qr_file_not_image') return 'Choose an image containing the login QR code.'
  if (code === 'login_qr_image_decode_failed') return 'This photo format could not be read. Try a JPEG or PNG image.'
  return 'No QR code was found. Keep the whole QR and its white border in frame, avoid glare, and try again.'
}

function showStatus(message: string, failed = false): void {
  const target = cameraDialog.open ? cameraStatus : status
  const inactive = target === status ? cameraStatus : status
  clearStatus(inactive)
  const state = failed ? 'error' : 'progress'
  if (target.textContent === message && target.dataset.state === state) return
  target.textContent = message
  target.dataset.state = state
  target.classList.toggle('alert-error', failed)
  target.classList.toggle('alert-info', !failed)
  if (target === status) statusShell.classList.remove('hidden')
}

function clearStatus(target: HTMLElement): void {
  target.textContent = ''
  delete target.dataset.state
  target.classList.remove('alert-error', 'alert-info')
  if (target === status) statusShell.classList.add('hidden')
}

function clearFileSelectionBeforePicker(): void {
  diagnostics.event('file_selection_clear', { previousFiles: fileInput.files?.length })
  fileInput.value = ''
}

function prepareFileHandoff(source: 'pointerdown' | 'touchstart' | 'keydown'): void {
  diagnostics.event('upload_activation', { source, disabled: fileInput.disabled, waitingForFile })
  if (fileInput.disabled || waitingForFile) return
  clearFileSelectionBeforePicker()
  waitingForFile = true
  markPhotoHandoff()
  fileReturnProbe.begin()
}

function beginPhotoHandoff(): void {
  diagnostics.event('file_handoff_begin')
  waitingForFile = true
  markPhotoHandoff()
  fileReturnProbe.begin()
  showStatus('Choose or take a photo containing the terminal login QR code.')
}

function resetNativeFileInput(): void {
  diagnostics.event('file_input_reset', { previousFiles: fileInput.files?.length })
  waitingForFile = false
  activeUploadFile = null
  returnedFromHidden = false
  fileReturnProbe.cancel()
  fileInput.disabled = false
  fileInput.value = ''
  fileInput.removeAttribute('aria-busy')
  captureInput.disabled = false
  captureInput.value = ''
  captureInput.removeAttribute('aria-busy')
}

function markPhotoHandoff(): void {
  try {
    sessionStorage.setItem(PHOTO_HANDOFF_KEY, String(Date.now()))
  } catch {
    // File selection still works when browser storage is unavailable.
  }
}

function clearPhotoHandoff(): void {
  try {
    sessionStorage.removeItem(PHOTO_HANDOFF_KEY)
  } catch {
    // Nothing else is required when browser storage is unavailable.
  }
}

function restoreInterruptedPhotoHandoff(): void {
  let startedAt = Number.NaN
  try {
    startedAt = Number(sessionStorage.getItem(PHOTO_HANDOFF_KEY))
    sessionStorage.removeItem(PHOTO_HANDOFF_KEY)
  } catch {
    return
  }
  const elapsedMs = Date.now() - startedAt
  if (!Number.isFinite(startedAt) || elapsedMs < 0 || elapsedMs > PHOTO_HANDOFF_TTL_MS) return
  showStatus(
    'The login page reloaded before the camera returned a photo. Take the photo first, then choose it from Photos or files.',
    true,
  )
}

function requiredElement<T extends Element>(
  id: string,
  constructor: { new(): T },
): T {
  const element = document.getElementById(id)
  if (!(element instanceof constructor)) throw new Error('missing_login_element:' + id)
  return element
}
