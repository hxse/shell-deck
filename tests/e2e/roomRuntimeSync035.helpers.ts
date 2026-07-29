import { expect } from 'playwright/test'

function sharedRuntimeDefinition() {
  return {
    schemaVersion: 6,
    name: 'Shared runtime',
    description: '',
    terminalLayout: [{ index: 1, type: 'text' }],
    body: [
      { id: 'wait', type: 'wait', mode: 'duration', durationMs: 2500 },
      {
        id: 'notify',
        type: 'notify',
        level: 'info',
        title: 'Runtime notification',
        message: { parts: [{ kind: 'text', text: 'same Room broadcast' }] },
        channels: [{ kind: 'app', toast: true, sound: 'none', repeatCount: 1, repeatIntervalMs: 1000 }],
        onFailure: 'continue',
      },
      { id: 'input', type: 'input', terminal: { kind: 'terminal_index', index: 1 }, prompt: 'Shared prompt', allowEmpty: false, delivery: 'direct', ending: 'none' },
    ],
  }
}

function completedRunDefinition() {
  return {
    schemaVersion: 6,
    name: 'Completed run unlock',
    description: '',
    terminalLayout: [{ index: 1, type: 'text' }],
    body: [{
      id: 'send',
      type: 'send',
      terminal: { kind: 'terminal_index', index: 1 },
      message: { parts: [{ kind: 'text', text: 'done' }] },
      delivery: 'direct',
      ending: 'none',
    }],
  }
}

function gapRepairDefinition() {
  return {
    schemaVersion: 6,
    name: 'Gap repair retry',
    description: '',
    terminalLayout: [],
    body: [
      { id: 'wait_1', type: 'wait', mode: 'duration', durationMs: 150 },
      { id: 'wait_2', type: 'wait', mode: 'duration', durationMs: 150 },
      { id: 'wait_3', type: 'wait', mode: 'duration', durationMs: 150 },
    ],
  }
}

function runtimeInputGenerationDefinition() {
  return {
    schemaVersion: 6,
    name: 'Runtime input generation',
    description: '',
    terminalLayout: [{ index: 1, type: 'text' }],
    body: [
      {
        id: 'seed',
        type: 'send',
        terminal: { kind: 'terminal_index', index: 1 },
        message: { parts: [{ kind: 'text', text: 'D' }] },
        delivery: 'direct',
        ending: 'none',
      },
      { id: 'capture', type: 'capture-source', capture: { kind: 'text-box', terminal: { kind: 'terminal_index', index: 1 } } },
      {
        id: 'input',
        type: 'input',
        terminal: { kind: 'terminal_index', index: 1 },
        prompt: 'Keep the latest local generation',
        allowEmpty: false,
        defaultSource: { kind: 'step_artifact', stepId: 'capture', artifact: 'captured_text' },
        delivery: 'direct',
        ending: 'none',
      },
    ],
  }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

async function openTemplateDrawer(page: import('playwright/test').Page) {
  if (await page.getByTestId('macro-insertion-cancel-scrim').count() > 0) await page.getByTestId('macro-insertion-cancel-scrim').click()
  if (await page.getByTestId('macro-template-drawer-body').count() === 0) await page.getByTestId('macro-template-drawer').click()
  await expect(page.getByTestId('macro-template-drawer-body')).toBeVisible()
}

async function installWebSocketCapture(page: import('playwright/test').Page) {
  await page.addInitScript(() => {
    const NativeWebSocket = window.WebSocket
    const sockets: WebSocket[] = []
    class CapturedWebSocket extends NativeWebSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols)
        sockets.push(this)
      }
    }
    window.WebSocket = CapturedWebSocket
    ;(window as Window & { __shellDeckTestSockets?: WebSocket[] }).__shellDeckTestSockets = sockets
  })
}

async function closeCapturedWebSocket(page: import('playwright/test').Page) {
  await page.evaluate(() => {
    const sockets = (window as Window & { __shellDeckTestSockets?: WebSocket[] }).__shellDeckTestSockets ?? []
    const socket = sockets.findLast((candidate) => candidate.readyState === WebSocket.OPEN)
    if (!socket) throw new Error('test_websocket_not_found')
    socket.close(4000, 'forced_reconnect')
  })
}

export {
  sharedRuntimeDefinition,
  completedRunDefinition,
  gapRepairDefinition,
  runtimeInputGenerationDefinition,
  deferred,
  openTemplateDrawer,
  installWebSocketCapture,
  closeCapturedWebSocket,
}
