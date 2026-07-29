import { describe, expect, test } from 'bun:test'
import type { ParallelNode } from '../../src/lib/macro/macroDefinitionTypes'
import { buildParallelTerminalUsage } from '../../src/lib/macro/parallelTerminalUsage'
import {
  executeMacroFlow,
  MacroFlowSignal,
  type MacroFlowExecutionContext,
} from '../../server/macroFlowExecutor'
import {
  ParallelSharedTextQueue,
  type MacroTerminalWriteRequest,
} from '../../server/parallelSharedTextQueue'

describe('20260729A Parallel shared Text queue', () => {
  test('pane order writes the expected action immediately and drains ready followers', async () => {
    const controller = new AbortController()
    const queue = queueFor('pane_order', controller.signal)
    const trace: string[] = []
    let laterSettled = false
    const later = queue.dispatch(request('send_b', trace))
      .then(() => { laterSettled = true })
    await Promise.resolve()
    expect(trace).toEqual([])
    expect(laterSettled).toBe(false)

    await queue.dispatch(request('send_a', trace))
    await later
    expect(trace).toEqual(['write:send_a', 'record:send_a', 'write:send_b', 'record:send_b'])
    queue.finish()
    queue.dispose()
  })

  test('completion order writes each pane as soon as its Send triggers', async () => {
    const queue = queueFor('completion_order', new AbortController().signal)
    const trace: string[] = []
    await queue.dispatch(request('send_b', trace))
    await queue.dispatch(request('send_a', trace))
    expect(trace).toEqual(['write:send_b', 'record:send_b', 'write:send_a', 'record:send_a'])
    queue.finish()
    queue.dispose()
  })

  test('each shared Text target drains independently', async () => {
    const queue = new ParallelSharedTextQueue([
      { terminalIndex: 1, order: 'pane_order', sendPlan: ['one_a', 'one_b'] },
      { terminalIndex: 2, order: 'pane_order', sendPlan: ['two_a', 'two_b'] },
    ], new AbortController().signal)
    const trace: string[] = []
    const oneLater = queue.dispatch({ ...request('one_b', trace), terminalIndex: 1 })
    const twoLater = queue.dispatch({ ...request('two_b', trace), terminalIndex: 2 })

    await queue.dispatch({ ...request('two_a', trace), terminalIndex: 2 })
    await twoLater
    expect(trace).toEqual([
      'write:two_a',
      'record:two_a',
      'write:two_b',
      'record:two_b',
    ])

    await queue.dispatch({ ...request('one_a', trace), terminalIndex: 1 })
    await oneLater
    expect(trace.slice(4)).toEqual([
      'write:one_a',
      'record:one_a',
      'write:one_b',
      'record:one_b',
    ])
    queue.finish()
    queue.dispose()
  })

  test('retry never duplicates a committed append and resumes pane-order waiters', async () => {
    const queue = queueFor('pane_order', new AbortController().signal)
    const trace: string[] = []
    const later = queue.dispatch(request('send_b', trace))
    let firstRecord = true
    await expect(queue.dispatch({
      stepId: 'send_a',
      terminalIndex: 1,
      write: () => { trace.push('write:send_a') },
      record: () => {
        if (firstRecord) {
          firstRecord = false
          throw new Error('record_failed')
        }
        trace.push('record:send_a')
      },
    })).rejects.toThrow('record_failed')

    await queue.dispatch({
      stepId: 'send_a',
      terminalIndex: 1,
      write: () => { throw new Error('append_must_not_repeat') },
      record: () => { trace.push('record:send_a') },
    })
    await later
    expect(trace).toEqual(['write:send_a', 'record:send_a', 'write:send_b', 'record:send_b'])
    queue.finish()
    queue.dispose()
  })

  test('a failed append keeps the pane-order cursor retryable', async () => {
    const queue = queueFor('pane_order', new AbortController().signal)
    const trace: string[] = []
    const later = queue.dispatch(request('send_b', trace))

    await expect(queue.dispatch({
      stepId: 'send_a',
      terminalIndex: 1,
      write: () => { throw new Error('append_failed') },
      record: () => { throw new Error('record_must_not_run') },
    })).rejects.toThrow('append_failed')
    expect(trace).toEqual([])

    await queue.dispatch(request('send_a', trace))
    await later
    expect(trace).toEqual(['write:send_a', 'record:send_a', 'write:send_b', 'record:send_b'])
    queue.finish()
    queue.dispose()
  })

  test('Stop cancels pending pane-order sends without rolling back committed Text', async () => {
    const controller = new AbortController()
    const queue = new ParallelSharedTextQueue([{
      terminalIndex: 1,
      order: 'pane_order',
      sendPlan: ['send_a', 'send_b', 'send_c'],
    }], controller.signal)
    const trace: string[] = []
    await queue.dispatch(request('send_a', trace))
    const pending = queue.dispatch(request('send_c', trace))
    controller.abort()
    await expect(pending).rejects.toThrow('run_stopped')
    expect(trace).toEqual(['write:send_a', 'record:send_a'])
    expect(() => queue.finish()).toThrow('run_stopped')
    queue.dispose()
  })

  test('Shell and exclusive Text retry event recording without repeating terminal input', async () => {
    const queue = new ParallelSharedTextQueue([], new AbortController().signal)
    const trace: string[] = []
    for (const [terminalIndex, label] of [[1, 'shell'], [2, 'exclusive_text']] as const) {
      await expect(queue.dispatch({
        stepId: label,
        terminalIndex,
        write: () => { trace.push(`write:${label}`) },
        record: () => { throw new Error(`record_failed:${label}`) },
      })).rejects.toThrow(`record_failed:${label}`)
      await queue.dispatch({
        stepId: label,
        terminalIndex,
        write: () => { throw new Error(`write_repeated:${label}`) },
        record: () => { trace.push(`record:${label}`) },
      })
    }
    expect(trace).toEqual([
      'write:shell',
      'record:shell',
      'write:exclusive_text',
      'record:exclusive_text',
    ])
    queue.finish()
    queue.dispose()
  })
})

describe('20260729A Parallel invocation cancellation', () => {
  for (const outcome of ['fail', 'finish'] as const) {
    test(`${outcome} cancels an unbounded sibling action before settling`, async () => {
      let siblingCancelled = false
      const context = flowContext(async (node, options) => {
        if (node.id === 'primary') {
          if (outcome === 'finish') throw new MacroFlowSignal('finish')
          throw new Error('synthetic_failure')
        }
        await waitForAbort(options?.abortSignal, () => { siblingCancelled = true })
      }, outcome === 'fail' ? 'fail' : 'pause')

      let failure: unknown
      try {
        await executeMacroFlow(context)
      } catch (error) {
        failure = error
      }
      if (outcome === 'finish') {
        expect(failure).toBeInstanceOf(MacroFlowSignal)
        expect((failure as MacroFlowSignal).signal).toBe('finish')
      } else {
        expect(String(failure)).toContain('parallel_lane_failed:lane_a:synthetic_failure')
      }
      expect(siblingCancelled).toBe(true)
    })
  }

  test('Stop cancels all active pane actions through the invocation signal', async () => {
    const controller = new AbortController()
    let started = 0
    let cancelled = 0
    const context = flowContext(async (_node, options) => {
      started += 1
      await waitForAbort(options?.abortSignal, () => { cancelled += 1 })
    }, 'fail', controller)
    const running = executeMacroFlow(context)
    await waitFor(() => started === 2)
    controller.abort()
    await expect(running).rejects.toThrow('run_stopped')
    expect(cancelled).toBe(2)
  })

  test('Pause preserves sibling actions and resumes only the failed pane', async () => {
    let attempts = 0
    let siblingSignal: AbortSignal | undefined
    let releaseSibling = noop
    let releasePause = noop
    const context = flowContext(async (node, options) => {
      if (node.id === 'primary' && attempts++ === 0) throw new Error('retry_me')
      if (node.id === 'sibling') {
        siblingSignal = options?.abortSignal
        await new Promise<void>((resolve) => { releaseSibling = resolve })
      }
    }, 'pause')
    context.callbacks.pauseRun = async () => {
      await new Promise<void>((resolve) => { releasePause = resolve })
    }
    const running = executeMacroFlow(context)
    await waitFor(() => Boolean(siblingSignal) && releasePause !== noop)
    expect(siblingSignal?.aborted).toBe(false)
    releasePause()
    await waitFor(() => attempts === 2)
    expect(siblingSignal?.aborted).toBe(false)
    releaseSibling()
    await running
  })
})

function queueFor(
  order: 'pane_order' | 'completion_order',
  signal: AbortSignal,
): ParallelSharedTextQueue {
  const parallel: ParallelNode = {
    id: 'parallel',
    type: 'parallel',
    sharedTextOrder: order,
    onLaneFail: 'pause',
    lanes: [
      { id: 'lane_a', label: 'A', body: [send('send_a')] },
      { id: 'lane_b', label: 'B', body: [send('send_b')] },
    ],
  }
  const usage = buildParallelTerminalUsage(parallel, [{ index: 1, type: 'text' }])
  return new ParallelSharedTextQueue(usage.sharedTextPlans, signal)
}

function send(id: string) {
  return {
    id,
    type: 'send' as const,
    terminal: { kind: 'terminal_index' as const, index: 1 },
    message: { parts: [{ kind: 'text' as const, text: id }] },
    delivery: 'direct' as const,
    ending: 'none' as const,
  }
}

function request(stepId: string, trace: string[]): MacroTerminalWriteRequest {
  return {
    stepId,
    terminalIndex: 1,
    write: () => { trace.push(`write:${stepId}`) },
    record: () => { trace.push(`record:${stepId}`) },
  }
}

function flowContext(
  executeAction: MacroFlowExecutionContext['callbacks']['executeAction'],
  onLaneFail: 'pause' | 'fail',
  controller = new AbortController(),
): MacroFlowExecutionContext {
  return {
    body: [{
      id: 'parallel',
      type: 'parallel',
      sharedTextOrder: 'pane_order',
      onLaneFail,
      lanes: [
        {
          id: 'lane_a',
          label: 'A',
          body: [{ id: 'primary', type: 'wait', mode: 'duration', durationMs: 1 }],
        },
        {
          id: 'lane_b',
          label: 'B',
          body: [{ id: 'sibling', type: 'wait', mode: 'duration', durationMs: 1 }],
        },
      ],
    }],
    terminalLayout: [],
    artifacts: new Map(),
    templateBindings: [],
    parallelProgress: new Map(),
    abortSignal: controller.signal,
    callbacks: {
      checkpoint: async () => {},
      setCurrentNodeId: () => {},
      appendEvent: () => {},
      executeAction,
      pauseRun: async () => {},
      isTerminalized: () => false,
      isCancellation: (error) => (
        controller.signal.aborted
        || (error instanceof Error && error.message === 'run_stopped')
      ),
    },
  }
}

function waitForAbort(signal: AbortSignal | undefined, onAbort: () => void): Promise<void> {
  if (!signal) throw new Error('parallel_abort_signal_missing')
  return new Promise((_resolve, reject) => {
    const abort = () => {
      onAbort()
      reject(new Error('run_stopped'))
    }
    if (signal.aborted) abort()
    else signal.addEventListener('abort', abort, { once: true })
  })
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 1))
  }
  throw new Error('condition_not_met')
}

function noop(): void {}
