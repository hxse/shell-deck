import { expect, test } from 'bun:test'
import { appendFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MacroRunnerService } from '../../server/macroRunnerService'
import { TerminalDeckManager } from '../../server/terminalDeckManager'
import { MacroTemplateStore } from '../../src/lib/macro/templateStore'
import type { MacroTemplate } from '../../src/lib/macro/templateTypes'
import { RunEventStore } from '../../src/lib/runLog/runEventStore'

function harness() {
  const root = mkdtempSync(join(tmpdir(), 'shell-deck-005-'))
  const manager = new TerminalDeckManager()
  manager.ensureConfig('local')
  manager.createTerminal('local', { backend: 'fake', terminalId: 'term_main_a', terminalAlias: 'main' })
  manager.createTerminal('local', { backend: 'fake', terminalId: 'term_review_b', terminalAlias: 'reviewer' })
  const templateStore = new MacroTemplateStore(root)
  const runStore = new RunEventStore(root)
  const service = new MacroRunnerService(manager, templateStore, runStore)
  return { root, manager, templateStore, runStore, service }
}

test('runner executes send_line and complete against fake terminal with event log', async () => {
  const h = harness()
  try {
    h.templateStore.save('local', template('send_complete', [
      { id: 'send', type: 'send_line', terminal: { kind: 'alias', value: 'main' }, text: 'runner-send', next: 'done' },
      { id: 'done', type: 'complete', reason: 'ok' },
    ]), h.manager.indexMap('local'))
    const started = await h.service.start('local', { templateId: 'send_complete' })
    expect(started.status).toBe('running')
    await waitFor(async () => h.service.snapshot('local').status === 'completed')
    const snapshot = h.service.snapshot('local')
    expect(snapshot.status).toBe('completed')
    expect(h.manager.deckSnapshot('local').terminals[0].replay.join('')).toContain('ECHO:runner-send')
    expect(snapshot.run?.replay.events.map((event) => event.kind)).toContain('terminal_line_sent')
  } finally {
    rmSync(h.root, { recursive: true, force: true })
  }
})

test('runner completes a send_line-only template without requiring an explicit complete step', async () => {
  const h = harness()
  try {
    h.templateStore.save('local', template('send_only', [
      { id: 'send', type: 'send_line', terminal: { kind: 'alias', value: 'main' }, text: 'runner-send-only' },
    ]), h.manager.indexMap('local'))
    await h.service.start('local', { templateId: 'send_only' })
    await waitFor(async () => h.service.snapshot('local').status === 'completed')
    const snapshot = h.service.snapshot('local')
    expect(snapshot.run?.replay.events.map((event) => event.kind)).toContain('run_completed')
    expect(h.manager.deckSnapshot('local').terminals[0].replay.join('')).toContain('ECHO:runner-send-only')
  } finally {
    rmSync(h.root, { recursive: true, force: true })
  }
})

test('runner waits for input_line, submits text, and blocks second live run in same config', async () => {
  const h = harness()
  try {
    h.templateStore.save('local', template('input_complete', [
      { id: 'ask', type: 'input_line', terminal: { kind: 'alias', value: 'main' }, prompt: 'Direction', allowEmpty: false, next: 'done' },
      { id: 'done', type: 'complete', reason: 'ok' },
    ]), h.manager.indexMap('local'))
    await h.service.start('local', { templateId: 'input_complete' })
    await waitFor(async () => h.service.snapshot('local').status === 'waiting_user_input')
    await expect(h.service.start('local', { templateId: 'input_complete' })).rejects.toThrow('live_run_exists')
    await h.service.submitInput('local', 'continue now')
    await waitFor(async () => h.service.snapshot('local').status === 'completed')
    expect(h.manager.deckSnapshot('local').terminals[0].replay.join('')).toContain('ECHO:continue now')
  } finally {
    rmSync(h.root, { recursive: true, force: true })
  }
})

test('runner supports terminal-buffer capture, regex parse, branch and loop guard pause', async () => {
  const h = harness()
  try {
    h.templateStore.save('local', template('loop_guard', [
      { id: 'capture', type: 'capture-source', capture: { kind: 'terminal-buffer', terminal: { kind: 'alias', value: 'reviewer' }, mode: 'scrollback-tail', maxChars: 12000 }, next: 'parse' },
      { id: 'parse', type: 'parse', captureStep: 'capture', parser: { kind: 'regex', rules: [{ signal: 'hasReadyText', type: 'boolean-null', pattern: 'ready', flags: 'i', onMatch: true, onNoMatch: false }] }, next: 'branch' },
      { id: 'branch', type: 'branch', fromParseStep: 'parse', conditions: [{ signal: 'hasReadyText', op: '==', value: true, goto: 'capture' }], else: 'done', loopGuard: { maxIterations: 1, onLimit: 'pause' } },
      { id: 'done', type: 'complete', reason: 'done' },
    ]), h.manager.indexMap('local'))
    h.manager.input('local', { kind: 'alias', value: 'reviewer' }, 'ready\r')
    await waitFor(async () => h.manager.deckSnapshot('local').terminals.some((terminal) => terminal.terminalId === 'term_review_b' && terminal.replay.join('').includes('ECHO:ready')))
    await h.service.start('local', { templateId: 'loop_guard' })
    await waitFor(async () => h.service.snapshot('local').status === 'paused')
    const snapshot = h.service.snapshot('local')
    expect(snapshot.pauseReason?.code).toBe('loop_guard_limit')
    expect(snapshot.run?.replay.events.map((event) => event.kind)).toContain('parser_normalized')
    expect(snapshot.run?.replay.events.map((event) => event.kind)).toContain('branch_decision')
    const transitionCounts = snapshot.run?.replay.events.filter((event) => event.kind === 'control_transition' && event.data.backEdge === true).map((event) => event.data.count)
    expect(transitionCounts).toEqual([1, 2])
  } finally {
    rmSync(h.root, { recursive: true, force: true })
  }
})

test('different config can run while local is waiting', async () => {
  const h = harness()
  try {
    h.manager.ensureConfig('other')
    h.manager.createTerminal('other', { backend: 'fake', terminalId: 'term_other', terminalAlias: 'main' })
    h.templateStore.save('local', template('waiting_local', [
      { id: 'ask', type: 'input_line', terminal: { kind: 'alias', value: 'main' }, prompt: 'Direction', allowEmpty: true },
    ]), h.manager.indexMap('local'))
    h.templateStore.save('other', { ...template('other_done', [{ id: 'done', type: 'complete', reason: 'ok' }]), configId: 'other' }, h.manager.indexMap('other'))
    await h.service.start('local', { templateId: 'waiting_local' })
    await waitFor(async () => h.service.snapshot('local').status === 'waiting_user_input')
    await h.service.start('other', { templateId: 'other_done' })
    await waitFor(async () => h.service.snapshot('other').status === 'completed')
    expect(h.service.snapshot('local').status).toBe('waiting_user_input')
  } finally {
    rmSync(h.root, { recursive: true, force: true })
  }
})

test("new service treats stored live run as interrupted until stopped", async () => {
  const h = harness()
  try {
    h.templateStore.save("local", template("interrupted_input", [
      { id: "ask", type: "input_line", terminal: { kind: "alias", value: "main" }, prompt: "Direction", allowEmpty: false, next: "done" },
      { id: "done", type: "complete", reason: "ok" },
    ]), h.manager.indexMap("local"))
    await h.service.start("local", { templateId: "interrupted_input" })
    await waitFor(async () => h.service.snapshot("local").status === "waiting_user_input")

    const recovered = new MacroRunnerService(h.manager, h.templateStore, h.runStore)
    expect(recovered.snapshot("local").status).toBe("interrupted")
    await expect(recovered.start("local", { templateId: "interrupted_input" })).rejects.toThrow("live_run_exists")
    const stopped = await recovered.stop("local")
    expect(stopped.status).toBe("idle")
    await recovered.start("local", { templateId: "interrupted_input" })
    await waitFor(async () => recovered.snapshot("local").status === "waiting_user_input")
  } finally {
    rmSync(h.root, { recursive: true, force: true })
  }
})

test('pause and stop cancel delayed steps without writing completion events', async () => {
  const paused = harness()
  try {
    paused.templateStore.save('local', template('sleep_pause', [
      { id: 'sleep', type: 'sleep', durationMs: 160, next: 'done' },
      { id: 'done', type: 'complete', reason: 'ok' },
    ]), paused.manager.indexMap('local'))
    await paused.service.start('local', { templateId: 'sleep_pause' })
    await waitFor(async () => eventKinds(paused).includes('sleep_started'))
    await paused.service.pause('local')
    await delayFor(220)
    expect(paused.service.snapshot('local').status).toBe('paused')
    expect(eventKinds(paused)).not.toContain('sleep_completed')
    expect(eventKinds(paused)).not.toContain('step_completed')
  } finally {
    rmSync(paused.root, { recursive: true, force: true })
  }

  const stopped = harness()
  try {
    stopped.templateStore.save('local', template('sleep_stop', [
      { id: 'sleep', type: 'sleep', durationMs: 160, next: 'done' },
      { id: 'done', type: 'complete', reason: 'ok' },
    ]), stopped.manager.indexMap('local'))
    await stopped.service.start('local', { templateId: 'sleep_stop' })
    await waitFor(async () => eventKinds(stopped).includes('sleep_started'))
    await stopped.service.stop('local')
    await delayFor(220)
    expect(stopped.service.snapshot('local').status).toBe('stopped')
    expect(eventKinds(stopped)).not.toContain('sleep_completed')
  } finally {
    rmSync(stopped.root, { recursive: true, force: true })
  }


  const waitPaused = harness()
  try {
    waitPaused.templateStore.save('local', template('wait_pause', [
      { id: 'wait', type: 'wait', mode: 'duration', durationMs: 160, next: 'done' },
      { id: 'done', type: 'complete', reason: 'ok' },
    ]), waitPaused.manager.indexMap('local'))
    await waitPaused.service.start('local', { templateId: 'wait_pause' })
    await waitFor(async () => eventKinds(waitPaused).includes('wait_started'))
    await waitPaused.service.pause('local')
    await delayFor(220)
    expect(waitPaused.service.snapshot('local').status).toBe('paused')
    expect(eventKinds(waitPaused)).not.toContain('wait_completed')
  } finally {
    rmSync(waitPaused.root, { recursive: true, force: true })
  }
})

test('wait modes support duration, terminal quiet, timeout and manual continue', async () => {
  const h = harness()
  try {
    h.templateStore.save('local', template('wait_duration', [
      { id: 'wait', type: 'wait', mode: 'duration', durationMs: 20, next: 'done' },
      { id: 'done', type: 'complete', reason: 'duration done' },
    ]), h.manager.indexMap('local'))
    await h.service.start('local', { templateId: 'wait_duration' })
    await waitFor(async () => h.service.snapshot('local').status === 'completed')
    expect(eventKinds(h)).toContain('wait_completed')

    h.templateStore.save('local', template('wait_quiet', [
      { id: 'wait', type: 'wait', mode: 'terminal-quiet', terminal: { kind: 'alias', value: 'main' }, quietMs: 25, maxMs: 160, onTimeout: 'fail', next: 'done' },
      { id: 'done', type: 'complete', reason: 'quiet done' },
    ]), h.manager.indexMap('local'))
    await h.service.start('local', { templateId: 'wait_quiet' })
    await waitFor(async () => h.service.snapshot('local').status === 'completed')
    expect(eventKinds(h)).toContain('terminal_ref_resolved')

    h.templateStore.save('local', template('wait_capture_ready', [
      { id: 'wait', type: 'wait', mode: 'capture-ready-or-user', captureStep: 'capture_ready', timeoutMs: 120, onTimeout: 'fail', next: 'capture_ready' },
      { id: 'capture_ready', type: 'capture-source', capture: { kind: 'terminal-buffer', terminal: { kind: 'alias', value: 'main' }, mode: 'scrollback-tail', maxChars: 12000 }, next: 'done_capture' },
      { id: 'done_capture', type: 'complete', reason: 'capture ready done' },
    ]), h.manager.indexMap('local'))
    await h.service.start('local', { templateId: 'wait_capture_ready' })
    await waitFor(async () => h.service.snapshot('local').status === 'completed')
    const readyEvents = h.service.snapshot('local').run?.replay.events ?? []
    const waitCompletedIndex = readyEvents.findIndex((event) => event.kind === 'wait_completed')
    const captureArtifactIndex = readyEvents.findIndex((event) => event.kind === 'capture_artifact_created')
    expect(waitCompletedIndex).toBeGreaterThan(-1)
    expect(captureArtifactIndex).toBeGreaterThan(waitCompletedIndex)

    h.templateStore.save('local', template('wait_timeout', [
      { id: 'wait', type: 'wait', mode: 'capture-ready-or-user', captureStep: 'capture_later', timeoutMs: 30, onTimeout: 'fail', next: 'done' },
      { id: 'capture_later', type: 'capture-source', capture: { kind: 'terminal-buffer', terminal: { kind: 'alias', value: 'main' }, mode: 'scrollback-tail', maxChars: 12000 } },
      { id: 'done', type: 'complete', reason: 'timeout should not reach' },
    ]), h.manager.indexMap('local'))
    await h.service.start('local', { templateId: 'wait_timeout', mockCaptureReady: false })
    await waitFor(async () => h.service.snapshot('local').status === 'failed')
    expect(eventKinds(h)).toContain('wait_timeout')
    expect(eventKinds(h)).toContain('step_failed')

    h.templateStore.save('local', template('wait_user_continue', [
      { id: 'wait', type: 'wait', mode: 'user-continue', prompt: 'Continue?', next: 'done' },
      { id: 'done', type: 'complete', reason: 'manual done' },
    ]), h.manager.indexMap('local'))
    await h.service.start('local', { templateId: 'wait_user_continue' })
    await waitFor(async () => h.service.snapshot('local').status === 'waiting')
    await h.service.resume('local')
    await waitFor(async () => h.service.snapshot('local').status === 'completed')
    expect(eventKinds(h)).toContain('wait_manual_continue')
  } finally {
    rmSync(h.root, { recursive: true, force: true })
  }
})

test('recoverable error run log does not block a new run', async () => {
  const h = harness()
  try {
    h.templateStore.save('local', template('recoverable_input', [
      { id: 'ask', type: 'input_line', terminal: { kind: 'alias', value: 'main' }, prompt: 'Direction', allowEmpty: false, next: 'done' },
      { id: 'done', type: 'complete', reason: 'ok' },
    ]), h.manager.indexMap('local'))
    await h.service.start('local', { templateId: 'recoverable_input' })
    await waitFor(async () => h.service.snapshot('local').status === 'waiting_user_input')
    const runId = h.service.snapshot('local').runId
    if (!runId) throw new Error('missing run id')
    appendFileSync(h.runStore.paths.eventsPath('local', runId), '{bad-json\n')

    const recovered = new MacroRunnerService(h.manager, h.templateStore, h.runStore)
    expect(recovered.snapshot('local').status).toBe('idle')
    await recovered.start('local', { templateId: 'recoverable_input' })
    await waitFor(async () => recovered.snapshot('local').status === 'waiting_user_input')
  } finally {
    rmSync(h.root, { recursive: true, force: true })
  }
})

test('fail and stop steps record step-level evidence', async () => {
  const h = harness()
  try {
    h.templateStore.save('local', template('fail_step', [
      { id: 'fail_here', type: 'fail', reason: 'configured failure' },
    ]), h.manager.indexMap('local'))
    await h.service.start('local', { templateId: 'fail_step' })
    await waitFor(async () => h.service.snapshot('local').status === 'failed')
    expect(eventKinds(h)).toContain('step_failed')
    expect(eventKinds(h)).toContain('run_failed')

    h.templateStore.save('local', template('stop_step', [
      { id: 'stop_here', type: 'stop', reason: 'configured stop' },
    ]), h.manager.indexMap('local'))
    await h.service.start('local', { templateId: 'stop_step' })
    await waitFor(async () => h.service.snapshot('local').status === 'stopped')
    const run = h.service.snapshot('local').run
    expect(run?.replay.events.map((event) => event.kind)).toContain('step_completed')
    expect(run?.replay.events.find((event) => event.kind === 'run_stopped')?.data.reason).toBe('configured stop')
  } finally {
    rmSync(h.root, { recursive: true, force: true })
  }
})

function template(id: string, steps: MacroTemplate['steps']): MacroTemplate {
  const now = new Date('2026-06-30T00:00:00.000Z').toISOString()
  return { schemaVersion: 1, id, name: id, description: '', configId: 'local', steps, createdAt: now, updatedAt: now }
}

async function waitFor(predicate: () => boolean | Promise<boolean>) {
  for (let i = 0; i < 80; i += 1) {
    if (await predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('timeout waiting for predicate')
}

function eventKinds(h: ReturnType<typeof harness>) {
  return h.service.snapshot('local').run?.replay.events.map((event) => event.kind) ?? []
}

function delayFor(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
