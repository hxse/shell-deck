import { mergeMacroRunnerDelta, validateMacroRunnerSnapshot } from './macro/runnerSnapshotMerge'
import type { MacroRunnerDelta, MacroRunnerSnapshot } from './macro/runnerTypes'

type RunnerRepairIdentity = {
  active: boolean
  connected: boolean
  roomId: string
  roomGeneration: string
  connectionGeneration: number
}

type RunnerRepairCoordinatorOptions = {
  identity(): RunnerRepairIdentity
  snapshot(): MacroRunnerSnapshot | null
  install(snapshot: MacroRunnerSnapshot): void
  notice(message: string): void
  fetcher?: RunnerRepairFetch
}

type RunnerRepairFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

const RUNNER_REPAIR_MAX_ATTEMPTS = 3
const RUNNER_REPAIR_RETRY_DELAYS_MS = [100, 300] as const

export class RunnerRepairCoordinator {
  readonly #options: RunnerRepairCoordinatorOptions
  readonly #fetcher: RunnerRepairFetch
  #pending = false
  #roomId = ''
  #roomGeneration = ''
  #attempts = 0
  #token = 0
  #timer: ReturnType<typeof setTimeout> | null = null
  #abort: AbortController | null = null
  #resyncInFlightToken: number | null = null
  #projectionTail: Promise<void> = Promise.resolve()

  constructor(options: RunnerRepairCoordinatorOptions) {
    this.#options = options
    this.#fetcher = options.fetcher ?? ((input, init) => globalThis.fetch(input, init))
  }

  get pending(): boolean { return this.#pending }
  get roomGeneration(): string { return this.#roomGeneration }

  handleDelta(delta: MacroRunnerDelta): void {
    void this.#queueProjection(async () => {
      const merged = await mergeMacroRunnerDelta(this.#options.snapshot(), delta)
      if (merged.kind === 'applied') this.#options.install(merged.snapshot)
      else if (merged.kind === 'resync_required') this.request(delta.roomGeneration)
      if (this.#pending) this.resume()
    }).catch(() => this.request(delta.roomGeneration))
  }

  request(expectedRoomGeneration: string): void {
    const identity = this.#options.identity()
    if (!identity.active || !identity.roomId || !expectedRoomGeneration) return
    if (!this.#pending || this.#roomId !== identity.roomId || this.#roomGeneration !== expectedRoomGeneration) {
      this.clear()
      this.#pending = true
      this.#roomId = identity.roomId
      this.#roomGeneration = expectedRoomGeneration
      this.#attempts = 0
    }
    this.resume()
  }

  resume(): void {
    const identity = this.#options.identity()
    if (!this.#pending || !identity.connected || !identity.active || !identity.roomId || identity.roomId !== this.#roomId) return
    if (identity.roomGeneration && identity.roomGeneration !== this.#roomGeneration) return
    if (this.#resyncInFlightToken !== null || this.#timer !== null) return
    if (this.#attempts >= RUNNER_REPAIR_MAX_ATTEMPTS) this.#attempts = 0
    this.#schedule(0)
  }

  resetForConnection(roomId: string): void {
    if (this.#pending && this.#roomId !== roomId) this.clear()
    else this.suspend()
  }

  installFull(snapshot: MacroRunnerSnapshot): void {
    void this.#queueProjection(async () => {
      const validated = await validateMacroRunnerSnapshot(snapshot)
      if (validated.kind !== 'applied') {
        this.request(snapshot.roomGeneration)
        return
      }
      const current = this.#options.snapshot()
      const mayInstall = !current
        || current.roomGeneration !== snapshot.roomGeneration
        || snapshot.runtimeRevision > current.runtimeRevision
        || (this.#pending && snapshot.runtimeRevision === current.runtimeRevision)
      if (!mayInstall) return
      this.#options.install(validated.snapshot)
      const identity = this.#options.identity()
      if (this.#pending && this.#roomId === identity.roomId && this.#roomGeneration === snapshot.roomGeneration) this.clear()
    }).catch(() => this.request(snapshot.roomGeneration))
  }

  suspend(): void {
    if (!this.#pending) return
    this.#token += 1
    this.#attempts = 0
    if (this.#timer) clearTimeout(this.#timer)
    this.#timer = null
    this.#abort?.abort()
    this.#abort = null
  }

  clear(): void {
    this.#pending = false
    this.#roomId = ''
    this.#roomGeneration = ''
    this.#attempts = 0
    this.#token += 1
    if (this.#timer) clearTimeout(this.#timer)
    this.#timer = null
    this.#abort?.abort()
    this.#abort = null
  }

  dispose(): void {
    this.clear()
  }

  #schedule(delayMs: number): void {
    if (!this.#pending || this.#resyncInFlightToken !== null || this.#timer !== null) return
    const token = this.#token
    this.#timer = setTimeout(() => {
      this.#timer = null
      if (token !== this.#token) return
      void this.#resync(token)
    }, delayMs)
  }

  async #resync(expectedToken: number): Promise<void> {
    const identity = this.#options.identity()
    if (!this.#pending || !identity.connected || expectedToken !== this.#token || this.#resyncInFlightToken !== null || !identity.active || !identity.roomId) return
    this.#resyncInFlightToken = expectedToken
    this.#attempts += 1
    const expectedRoomId = identity.roomId
    const expectedRoomGeneration = this.#roomGeneration
    const expectedConnectionGeneration = identity.connectionGeneration
    const abort = new AbortController()
    this.#abort = abort
    try {
      const response = await this.#fetcher(`/api/rooms/${encodeURIComponent(expectedRoomId)}/runner`, { signal: abort.signal })
      const body = await response.json() as { ok?: boolean; runner?: MacroRunnerSnapshot; error?: string }
      if (!response.ok || body.ok !== true || !body.runner) throw new Error(body.error ?? 'runner_resync_failed')
      if (!this.#identityMatches(expectedToken, expectedRoomId, expectedRoomGeneration, expectedConnectionGeneration)) return
      if (body.runner.roomId !== expectedRoomId || body.runner.roomGeneration !== expectedRoomGeneration) throw new Error('runner_resync_identity_mismatch')
      await this.#queueProjection(async () => {
        const validated = await validateMacroRunnerSnapshot(body.runner!)
        if (validated.kind !== 'applied') throw new Error('runner_resync_invalid_snapshot')
        const current = this.#options.snapshot()
        if (current?.roomGeneration === body.runner!.roomGeneration && body.runner!.runtimeRevision < current.runtimeRevision) {
          throw new Error('runner_resync_stale_snapshot')
        }
        this.#options.install(validated.snapshot)
      })
      this.clear()
    } catch (error) {
      if (abort.signal.aborted || !this.#identityMatches(expectedToken, expectedRoomId, expectedRoomGeneration, expectedConnectionGeneration)) return
      if (this.#attempts < RUNNER_REPAIR_MAX_ATTEMPTS) {
        const delay = RUNNER_REPAIR_RETRY_DELAYS_MS[this.#attempts - 1] ?? RUNNER_REPAIR_RETRY_DELAYS_MS.at(-1)!
        this.#schedule(delay)
      } else {
        this.#options.notice('runner_resync_pending: ' + messageOf(error))
      }
    } finally {
      if (this.#abort === abort) this.#abort = null
      if (this.#resyncInFlightToken === expectedToken) this.#resyncInFlightToken = null
      if (this.#pending && this.#token === expectedToken && this.#attempts < RUNNER_REPAIR_MAX_ATTEMPTS && this.#timer === null) {
        const delay = RUNNER_REPAIR_RETRY_DELAYS_MS[this.#attempts - 1] ?? RUNNER_REPAIR_RETRY_DELAYS_MS.at(-1)!
        this.#schedule(delay)
      }
      else if (this.#pending && this.#token !== expectedToken) this.resume()
    }
  }

  #identityMatches(
    expectedToken: number,
    expectedRoomId: string,
    expectedRoomGeneration: string,
    expectedConnectionGeneration: number,
  ): boolean {
    const identity = this.#options.identity()
    return this.#pending
      && this.#token === expectedToken
      && identity.active
      && identity.roomId === expectedRoomId
      && this.#roomId === expectedRoomId
      && this.#roomGeneration === expectedRoomGeneration
      && identity.connectionGeneration === expectedConnectionGeneration
  }

  #queueProjection(operation: () => Promise<void>): Promise<void> {
    const next = this.#projectionTail.then(operation, operation)
    this.#projectionTail = next.catch(() => {})
    return next
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
