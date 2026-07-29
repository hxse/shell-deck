import { describe, expect, test } from 'bun:test'
import type { FlowV2Node } from '../../src/lib/macro/macroDefinitionTypes'
import {
  executeMacroFlow,
  MacroFlowSignal,
  type MacroFlowExecutionContext,
} from '../../server/macroFlowExecutor'
import {
  assignedMacroTerminalIndex,
  extractMacroText,
  matchesMacroCondition,
  readMacroArtifact,
  renderMacroMessage,
  renderMacroScalar,
  type MacroArtifactMap,
} from '../../server/macroTextEvaluation'

describe('Macro runner execution extraction', () => {
  test('text, artifact, scoped template, condition and extract evaluation stay exact', () => {
    const artifacts: MacroArtifactMap = new Map([
      ['capture', new Map([['captured_text', { kind: 'text', value: '  READY\nsecond\n' }]])],
    ])
    const binding = { index: 2, key: 'target', value: 'VALUE', forStepId: 'loop' }

    expect(renderMacroMessage({ parts: [
      { kind: 'text', text: 'prefix:' },
      { kind: 'template', template: '{{index}}:{{key}}={{value}}:' },
      { kind: 'artifact', source: { kind: 'step_artifact', stepId: 'capture', artifact: 'captured_text' } },
    ] }, artifacts, binding)).toBe('prefix:2:target=VALUE:  READY\nsecond\n')
    expect(renderMacroScalar({ kind: 'template', template: '{{value}}/{{index}}' }, binding)).toBe('VALUE/2')
    expect(readMacroArtifact(artifacts, { kind: 'step_artifact', stepId: 'capture', artifact: 'captured_text' }))
      .toBe('  READY\nsecond\n')
    expect(() => readMacroArtifact(artifacts, { kind: 'unassigned' })).toThrow('unassigned_artifact_reference')
    expect(() => readMacroArtifact(artifacts, { kind: 'step_artifact', stepId: 'missing', artifact: 'captured_text' }))
      .toThrow('artifact_not_found')
    expect(assignedMacroTerminalIndex({ kind: 'terminal_index', index: 3 })).toBe(3)
    expect(() => assignedMacroTerminalIndex({ kind: 'unassigned' })).toThrow('unassigned_terminal_reference')

    expect(matchesMacroCondition(new Map([
      ['capture', new Map([['captured_text', { kind: 'text', value: 'first\nREADY\n' }]])],
    ]), {
      kind: 'text_match',
      source: { kind: 'step_artifact', stepId: 'capture', artifact: 'captured_text' },
      matcher: { kind: 'simple', op: 'equals', text: 'READY' },
      scope: { kind: 'lines', mode: 'any', includeEmptyLines: false },
    })).toBe(true)
    expect(matchesMacroCondition(new Map([
      ['capture', new Map([['captured_text', { kind: 'text', value: 'first\nlast' }]])],
    ]), {
      kind: 'text_match',
      source: { kind: 'step_artifact', stepId: 'capture', artifact: 'captured_text' },
      matcher: { kind: 'regex', pattern: '^last$' },
      scope: { kind: 'lines', mode: 'last', includeEmptyLines: true },
    })).toBe(true)

    expect(extractMacroText('zero\n one \n two ', {
      id: 'extract',
      type: 'extract_text',
      source: { kind: 'step_artifact', stepId: 'capture', artifact: 'captured_text' },
      split: { kind: 'lines', keepEmpty: false },
      filters: [{ kind: 'include', matcher: { kind: 'simple', op: 'contains', text: ' ' } }],
      select: { mode: 'index', index: -1 },
      extract: { kind: 'regex', pattern: '(two)', group: 1 },
      trim: 'both',
      onEmpty: 'fail',
    })).toBe('two')
  })

  test('nested For, If, Parallel and Finish preserve callback and lifecycle ordering', async () => {
    const artifacts: MacroArtifactMap = new Map([
      ['seed', new Map([['captured_text', { kind: 'text', value: 'READY' }]])],
    ])
    const trace: string[] = []
    const context = executionContext(artifacts, trace, [{
      id: 'loop',
      type: 'for',
      range: { kind: 'text-list', items: [{ key: 'only', value: 'value' }] },
      body: [{
        id: 'branch',
        type: 'if',
        branches: [{
          kind: 'if',
          condition: {
            kind: 'text_match',
            source: { kind: 'step_artifact', stepId: 'seed', artifact: 'captured_text' },
            matcher: { kind: 'simple', op: 'equals', text: 'READY' },
            scope: { kind: 'whole' },
          },
          body: [{
            id: 'parallel',
            type: 'parallel',
            lanes: [
              {
                id: 'lane_a',
                label: 'A',
                body: [{ id: 'lane_a_wait', type: 'wait', mode: 'duration', durationMs: 1 }],
              },
              {
                id: 'lane_b',
                label: 'B',
                body: [],
              },
            ],
            sharedTextOrder: 'pane_order',
            onLaneFail: 'fail',
          }],
        }],
      }, {
        id: 'finish',
        type: 'finish',
        body: [{ id: 'before_finish', type: 'wait', mode: 'duration', durationMs: 1 }],
      }],
    }, {
      id: 'unreachable', type: 'wait', mode: 'duration', durationMs: 1,
    }])

    let caught: unknown
    try {
      await executeMacroFlow(context)
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(MacroFlowSignal)
    expect((caught as MacroFlowSignal).signal).toBe('finish')
    expect(context.templateBindings).toEqual([])
    expect(artifacts.has('parallel')).toBe(false)
    expect(trace).toContain('action:lane_a_wait')
    expect(trace).toContain('step_completed:parallel')
    expect(trace).toContain('action:before_finish')
    expect(trace).not.toContain('step_completed:finish')
    expect(trace).not.toContain('step_started:unreachable')
  })

  test('Continue and Break retain loop control without completing control-terminal steps', async () => {
    const trace: string[] = []
    const context = executionContext(new Map(), trace, [{
      id: 'continue_loop',
      type: 'for',
      range: { kind: 'count', count: 2 },
      body: [{
        id: 'continue',
        type: 'continue',
        body: [{ id: 'before_continue', type: 'wait', mode: 'duration', durationMs: 1 }],
      }, { id: 'after_continue', type: 'wait', mode: 'duration', durationMs: 1 }],
    }, {
      id: 'break_loop',
      type: 'for',
      range: { kind: 'count', count: 3 },
      body: [{
        id: 'break',
        type: 'break',
        body: [{ id: 'before_break', type: 'wait', mode: 'duration', durationMs: 1 }],
      }, { id: 'after_break', type: 'wait', mode: 'duration', durationMs: 1 }],
    }])

    await executeMacroFlow(context)

    expect(trace.filter((item) => item === 'action:before_continue')).toHaveLength(2)
    expect(trace.filter((item) => item === 'action:before_break')).toHaveLength(1)
    expect(trace).not.toContain('action:after_continue')
    expect(trace).not.toContain('action:after_break')
    expect(trace).not.toContain('step_completed:continue')
    expect(trace).not.toContain('step_completed:break')
    expect(trace.at(-1)).toBe('step_completed:break_loop')
  })

  test('a pane action finish outcome exits Parallel without becoming a lane failure', async () => {
    const trace: string[] = []
    const context = executionContext(new Map(), trace, [{
      id: 'parallel',
      type: 'parallel',
      sharedTextOrder: 'pane_order',
      onLaneFail: 'fail',
      lanes: [
        {
          id: 'lane_a',
          label: 'A',
          body: [{ id: 'finish_from_action', type: 'wait', mode: 'duration', durationMs: 1 }],
        },
        { id: 'lane_b', label: 'B', body: [] },
      ],
    }])
    context.callbacks.executeAction = async (node) => {
      trace.push(`action:${node.id}`)
      if (node.id === 'finish_from_action') throw new MacroFlowSignal('finish')
    }

    await expect(executeMacroFlow(context)).rejects.toMatchObject({ signal: 'finish' })
    expect(trace).not.toContain('step_failed:parallel')
  })

  test('Pause retries the failed pane and drains shared Text waiters in pane order', async () => {
    const trace: string[] = []
    const context = executionContext(new Map(), trace, [{
      id: 'parallel',
      type: 'parallel',
      sharedTextOrder: 'pane_order',
      onLaneFail: 'pause',
      lanes: [
        { id: 'lane_a', label: 'A', body: [parallelTextSend('send_a')] },
        { id: 'lane_b', label: 'B', body: [parallelTextSend('send_b')] },
      ],
    }])
    context.terminalLayout = [{ index: 1, type: 'text' }]
    let firstAttempt = true
    let pauses = 0
    context.callbacks.pauseRun = async () => { pauses += 1 }
    context.callbacks.executeAction = async (node, options) => {
      if (node.id === 'send_a' && firstAttempt) {
        firstAttempt = false
        throw new Error('retry_me')
      }
      await options?.dispatchTerminalWrite?.({
        stepId: node.id,
        terminalIndex: 1,
        write: () => { trace.push(`write:${node.id}`) },
        record: () => { trace.push(`record:${node.id}`) },
      })
    }

    await executeMacroFlow(context)

    expect(pauses).toBe(1)
    expect(trace.filter((item) => item.startsWith('write:'))).toEqual([
      'write:send_a',
      'write:send_b',
    ])
  })
})

function parallelTextSend(id: string) {
  return {
    id,
    type: 'send' as const,
    terminal: { kind: 'terminal_index' as const, index: 1 },
    message: { parts: [] },
    delivery: 'direct' as const,
    ending: 'none' as const,
  }
}

function executionContext(
  artifacts: MacroArtifactMap,
  trace: string[],
  body: FlowV2Node[],
): MacroFlowExecutionContext {
  return {
    body,
    terminalLayout: [],
    artifacts,
    templateBindings: [],
    parallelProgress: new Map(),
    abortSignal: new AbortController().signal,
    callbacks: {
      checkpoint: async () => { trace.push('checkpoint') },
      setCurrentNodeId: () => {},
      appendEvent: (kind, data) => { trace.push(`${kind}:${String(data?.stepId ?? '')}`) },
      executeAction: async (node) => { trace.push(`action:${node.id}`) },
      pauseRun: async () => {},
      isTerminalized: () => false,
      isCancellation: () => false,
    },
  }
}
