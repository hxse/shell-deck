import { decodeLoginTokenImage } from './loginQrDecoder'

export const LIVE_QR_MAX_FRAME_EDGE = 720
export const LIVE_QR_MIN_START_INTERVAL_MS = 125
const LIVE_QR_WORK_INTERVAL_FACTOR = 3

export type LiveQrTimer = {
  now(): number
  schedule(callback: () => void, delayMs: number): number
  cancel(handle: number): void
}

type CameraElements = {
  dialog: HTMLDialogElement
  video: HTMLVideoElement
}

type CameraCallbacks = {
  onStatus(message: string, failed?: boolean): void
  onToken(token: string): void
}

const browserTimer: LiveQrTimer = {
  now: () => performance.now(),
  schedule: (callback, delayMs) => window.setTimeout(callback, delayMs),
  cancel: (handle) => window.clearTimeout(handle),
}

export class LoginQrCameraScanner {
  readonly #canvas = document.createElement('canvas')
  #context: CanvasRenderingContext2D | null = null
  #generation = 0
  #stopLoop: (() => void) | null = null
  #stream: MediaStream | null = null

  constructor(
    private readonly elements: CameraElements,
    private readonly callbacks: CameraCallbacks,
  ) {}

  async start(): Promise<void> {
    const unavailable = liveQrCameraUnavailableMessage(
      window.isSecureContext,
      typeof navigator.mediaDevices?.getUserMedia === 'function',
      typeof this.elements.dialog.showModal === 'function',
    )
    if (unavailable) {
      this.callbacks.onStatus(unavailable, true)
      return
    }

    this.stop()
    const generation = this.#generation
    this.elements.dialog.showModal()
    this.callbacks.onStatus('Starting camera…')
    let stream: MediaStream | null = null
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 15, max: 30 },
        },
      })
      if (generation !== this.#generation) {
        stopTracks(stream)
        return
      }
      this.#stream = stream
      this.elements.video.srcObject = stream
      await this.elements.video.play()
      if (generation !== this.#generation) {
        stopTracks(stream)
        return
      }
      this.callbacks.onStatus('Point the camera at the terminal login QR code.')
      this.#stopLoop = startLiveQrFrameLoop(
        () => this.#scanFrame(generation),
        (error) => this.#fail(generation, cameraErrorMessage(error)),
      )
    } catch (error) {
      if (generation !== this.#generation) {
        if (stream) stopTracks(stream)
        return
      }
      this.#fail(generation, cameraErrorMessage(error))
    }
  }

  stop(): void {
    this.#generation += 1
    this.#stopLoop?.()
    this.#stopLoop = null
    if (this.#stream) stopTracks(this.#stream)
    this.#stream = null
    this.elements.video.pause()
    this.elements.video.srcObject = null
    if (this.elements.dialog.open) this.elements.dialog.close()
  }

  #scanFrame(generation: number): void {
    if (generation !== this.#generation || this.elements.video.readyState < 2) return
    const { width, height } = liveQrFrameSize(
      this.elements.video.videoWidth,
      this.elements.video.videoHeight,
    )
    if (this.#canvas.width !== width) this.#canvas.width = width
    if (this.#canvas.height !== height) this.#canvas.height = height
    this.#context ??= this.#canvas.getContext('2d', { willReadFrequently: true })
    if (!this.#context) throw new Error('login_qr_canvas_unavailable')
    this.#context.drawImage(this.elements.video, 0, 0, width, height)
    try {
      const token = decodeLoginTokenImage(this.#context.getImageData(0, 0, width, height))
      this.stop()
      this.callbacks.onStatus('Token scanned. Logging in…')
      this.callbacks.onToken(token)
    } catch (error) {
      if (error instanceof Error && error.message === 'login_qr_not_found') return
      if (error instanceof Error && error.message === 'login_qr_payload_invalid') {
        this.callbacks.onStatus('The QR code is not a shell-deck login token.', true)
        return
      }
      throw error
    }
  }

  #fail(generation: number, message: string): void {
    if (generation !== this.#generation) return
    this.stop()
    this.callbacks.onStatus(message, true)
  }
}

export function liveQrFrameSize(width: number, height: number): { width: number; height: number } {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    throw new Error('login_qr_camera_frame_invalid')
  }
  const scale = Math.min(1, LIVE_QR_MAX_FRAME_EDGE / Math.max(width, height))
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

export function liveQrCameraUnavailableMessage(
  secureContext: boolean,
  hasGetUserMedia: boolean,
  hasDialog: boolean,
): string | null {
  if (!secureContext) return 'Live camera scanning requires HTTPS or localhost.'
  if (!hasGetUserMedia || !hasDialog) return 'Live camera scanning is not supported by this browser.'
  return null
}

export function nextLiveQrScanDelayMs(elapsedMs: number): number {
  const elapsed = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0
  const startInterval = Math.max(
    LIVE_QR_MIN_START_INTERVAL_MS,
    elapsed * LIVE_QR_WORK_INTERVAL_FACTOR,
  )
  return Math.ceil(Math.max(0, startInterval - elapsed))
}

export function startLiveQrFrameLoop(
  scanFrame: () => void | Promise<void>,
  onFailure: (error: unknown) => void,
  timer: LiveQrTimer = browserTimer,
): () => void {
  let stopped = false
  let handle: number | null = null
  const run = async () => {
    handle = null
    if (stopped) return
    const startedAt = timer.now()
    try {
      await scanFrame()
    } catch (error) {
      stopped = true
      onFailure(error)
      return
    }
    if (stopped) return
    handle = timer.schedule(
      () => void run(),
      nextLiveQrScanDelayMs(timer.now() - startedAt),
    )
  }
  handle = timer.schedule(() => void run(), 0)
  return () => {
    stopped = true
    if (handle !== null) timer.cancel(handle)
    handle = null
  }
}

function stopTracks(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop()
}

function cameraErrorMessage(error: unknown): string {
  const name = error instanceof Error ? error.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Camera permission was denied.'
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No usable camera was found.'
  return 'The live camera could not be started.'
}
