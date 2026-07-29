import { expect, test } from 'bun:test'
import {
  addParallelLane,
  addParallelLaneAction,
  moveParallelLaneAction,
  removeParallelLane,
  removeParallelLaneAction,
  renameParallelLane,
  renameParallelLaneAction,
  setParallelActionTerminal,
  setParallelLaneLabel,
} from '../../src/lib/components/macro/parallelLaneEditorCommands'
import {
  expectedParallelTerminalTypeAt,
  findParallel,
  findParallelLane,
  parallelActionCaptureKinds,
  parallelActionTerminalChoices,
  parallelActionUsage,
  parallelLaneActionPaletteItems,
  unavailableParallelActionTerminalValues,
} from '../../src/lib/components/macro/parallelLaneEditorPolicy'
import type {
  MacroDefinitionV6,
  ParallelLaneActionNode,
  ParallelNode,
} from '../../src/lib/macro/macroDefinitionTypes'
import {
  buildParallelTerminalUsage,
  parallelTerminalUsageLabel,
} from '../../src/lib/macro/parallelTerminalUsage'
import { terminalChoice, type TerminalChoice } from '../../src/lib/macro/macroTerminalChoices'
import { validateMacroDefinitionV6 } from '../../src/lib/macro/macroDefinitionValidation'

const terminalChoices: TerminalChoice[] = [
  terminalChoice({ index: 1, type: 'shell' }),
  terminalChoice({ index: 2, type: 'shell' }),
  terminalChoice({ index: 3, type: 'text' }),
  terminalChoice({ index: 4, type: 'text' }),
]

test('parallel editor policy derives action capabilities and exact usage labels', () => {
  const draft = definition()
  const node = findParallel(draft.body, 'parallel')
  if (!node) throw new Error('parallel_missing')
  const shellSend = node.lanes[0].body[0]
  const exclusiveCapture = node.lanes[0].body[1]
  const sharedSend = node.lanes[0].body[2]
  expect(parallelLaneActionPaletteItems().map(({ type }) => type))
    .toEqual(['send', 'wait', 'capture-source', 'extract_text', 'notify'])
  expect(parallelActionTerminalChoices(shellSend, terminalChoices).map(({ index }) => index))
    .toEqual([1, 2, 3, 4])
  if (exclusiveCapture.type !== 'capture-source') throw new Error('capture_missing')
  expect(parallelActionCaptureKinds(exclusiveCapture, terminalChoices)).toEqual(['text-box'])
  expect(expectedParallelTerminalTypeAt(draft, exclusiveCapture.capture.terminal)).toBe('text')

  const usage = buildParallelTerminalUsage(node, draft.terminalLayout)
  expect(parallelTerminalUsageLabel(usage.byActionId.get(shellSend.id)!))
    .toBe('Shell · owned by lane_1')
  expect(parallelTerminalUsageLabel(parallelActionUsage(draft, node, exclusiveCapture, usage)!))
    .toBe('Exclusive Text')
  expect(parallelTerminalUsageLabel(parallelActionUsage(draft, node, sharedSend, usage)!))
    .toBe('Shared Text · pane order')
  expect(usage.sharedTextPlans[0]?.sendPlan).toEqual(['shared_a', 'shared_b'])
  expect(usage.conflicts).toEqual([])
})

test('terminal availability prevents cross-pane Shell and shared Text reads', () => {
  const draft = definition()
  const node = draft.body[0] as ParallelNode
  const laneTwo = node.lanes[1]
  const laneTwoSend = laneTwo.body[0]
  const initialUsage = buildParallelTerminalUsage(node, draft.terminalLayout)
  expect(unavailableParallelActionTerminalValues(
    draft,
    node,
    laneTwo.id,
    laneTwoSend,
    terminalChoices,
    initialUsage,
  )).toEqual(['1', '4'])

  const capture = captureAction('candidate_capture', 4)
  laneTwo.body.push(capture)
  const usageWithCapture = buildParallelTerminalUsage(node, draft.terminalLayout)
  expect(unavailableParallelActionTerminalValues(
    draft,
    node,
    laneTwo.id,
    capture,
    terminalChoices,
    usageWithCapture,
  )).toEqual(['3', '4'])

  const invalidShell = structuredClone(draft)
  const invalidShellNode = invalidShell.body[0] as ParallelNode
  ;(invalidShellNode.lanes[1].body[0] as Extract<ParallelLaneActionNode, { type: 'send' }>).terminal = {
    kind: 'terminal_index',
    index: 1,
  }
  expect(validateMacroDefinitionV6(invalidShell).ok).toBe(false)

  const invalidSharedRead = structuredClone(draft)
  const invalidSharedNode = invalidSharedRead.body[0] as ParallelNode
  invalidSharedNode.lanes[1].body.push(captureAction('shared_read', 3))
  expect(validateMacroDefinitionV6(invalidSharedRead).ok).toBe(false)
})

test('an unassigned pane action can select a live terminal beyond the empty draft layout', () => {
  const draft = definition()
  draft.terminalLayout = []
  const node = draft.body[0] as ParallelNode
  node.lanes = [{
    id: 'lane_1',
    label: 'Alpha',
    body: [sendAction('unassigned_send', 1)],
  }]
  const send = node.lanes[0].body[0] as Extract<ParallelLaneActionNode, { type: 'send' }>
  send.terminal = { kind: 'unassigned' }

  expect(unavailableParallelActionTerminalValues(
    draft,
    node,
    'lane_1',
    send,
    terminalChoices,
  )).toEqual([])
})

test('parallel editor commands mutate only pane/action structure and explicit targets', () => {
  const draft = definition()
  expect(renameParallelLane(draft, 'parallel', 'lane_1', 'lane_2')).toEqual({
    ok: false,
    reason: 'duplicate_lane_id',
  })
  expect(setParallelLaneLabel(draft, 'parallel', 'lane_1', 'Beta')).toEqual({
    ok: false,
    reason: 'duplicate_lane_label',
  })
  expect(renameParallelLaneAction(draft, 'parallel', 'lane_1', 'shared_a', 'shared_b'))
    .toEqual({ ok: false, reason: 'duplicate_node_id' })

  const addedLane = addParallelLane(draft, 'parallel')
  expect(addedLane.ok && addedLane.addedLaneId).toBe('lane_3')
  const node = draft.body[0] as ParallelNode
  expect(node.lanes[2]).toEqual({ id: 'lane_3', label: 'lane_3', body: [] })

  const addedAction = addParallelLaneAction(draft, 'parallel', 'lane_3', 'notify')
  if (!addedAction.ok || !addedAction.addedActionId) throw new Error('notify_not_added')
  expect(node.lanes[2].body[0]?.type).toBe('notify')
  const send = addParallelLaneAction(draft, 'parallel', 'lane_3', 'send')
  if (!send.ok || !send.addedActionId) throw new Error('send_not_added')

  let adopted = 0
  expect(setParallelActionTerminal(
    draft,
    'parallel',
    'lane_3',
    send.addedActionId,
    { kind: 'terminal_index', index: 2 },
    (_template, index) => { adopted = index; return true },
  )).toEqual({ ok: true })
  expect(adopted).toBe(2)
  expect((node.lanes[2].body[1] as Extract<ParallelLaneActionNode, { type: 'send' }>).terminal)
    .toEqual({ kind: 'terminal_index', index: 2 })

  expect(moveParallelLaneAction(draft, 'parallel', 'lane_3', send.addedActionId, -1))
    .toEqual({ ok: true })
  expect(node.lanes[2].body[0]?.id).toBe(send.addedActionId)
  expect(removeParallelLaneAction(draft, 'parallel', 'lane_3', send.addedActionId))
    .toEqual({ ok: true, removedActionIds: [send.addedActionId] })
  expect(removeParallelLane(draft, 'parallel', 'lane_3')).toEqual({
    ok: true,
    removedLaneId: 'lane_3',
    removedActionIds: [addedAction.addedActionId],
  })
  expect(findParallelLane(node, 'lane_3')).toBeUndefined()
})

function definition(): MacroDefinitionV6 {
  return {
    schemaVersion: 6,
    name: 'Parallel editor',
    description: '',
    terminalLayout: [
      { index: 1, type: 'shell' },
      { index: 2, type: 'shell' },
      { index: 3, type: 'text' },
      { index: 4, type: 'text' },
    ],
    body: [{
      id: 'parallel',
      type: 'parallel',
      sharedTextOrder: 'pane_order',
      onLaneFail: 'pause',
      lanes: [
        {
          id: 'lane_1',
          label: 'Alpha',
          body: [
            sendAction('shell_a', 1),
            captureAction('exclusive_capture', 4),
            sendAction('shared_a', 3),
          ],
        },
        {
          id: 'lane_2',
          label: 'Beta',
          body: [sendAction('shared_b', 3)],
        },
      ],
    }],
  }
}

function sendAction(
  id: string,
  terminalIndex: number,
): Extract<ParallelLaneActionNode, { type: 'send' }> {
  return {
    id,
    type: 'send',
    terminal: { kind: 'terminal_index', index: terminalIndex },
    message: { parts: [{ kind: 'text', text: id }] },
    delivery: 'direct',
    ending: 'none',
  }
}

function captureAction(
  id: string,
  terminalIndex: number,
): Extract<ParallelLaneActionNode, { type: 'capture-source' }> {
  return {
    id,
    type: 'capture-source',
    capture: { kind: 'text-box', terminal: { kind: 'terminal_index', index: terminalIndex } },
  }
}
