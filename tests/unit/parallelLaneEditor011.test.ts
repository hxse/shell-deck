import { expect, test } from 'bun:test'
import {
  addParallelLane,
  addParallelLaneAction,
  moveParallelLaneAction,
  removeParallelLane,
  removeParallelLaneAction,
  renameParallelLane,
  renameParallelLaneAction,
  renameParallelLaneOutput,
  setParallelLaneCollectsText,
  setParallelLaneLabel,
  setParallelLaneTerminal,
  type ParallelLaneCommandResult,
} from '../../src/lib/components/macro/parallelLaneEditorCommands'
import {
  expectedParallelTerminalTypeAt,
  findParallel,
  incompatibleParallelLaneActionIds,
  parallelCollectsAnyLaneText,
  parallelLaneActionPaletteItems,
  parallelLaneCaptureKinds,
  parallelLaneOutput,
  parallelLaneOutputSourceChoices,
  selectedParallelLane,
  unavailableParallelLaneTerminalValues,
} from '../../src/lib/components/macro/parallelLaneEditorPolicy'
import type { MacroDefinitionV5, ParallelLane, ParallelNode } from '../../src/lib/macro/macroDefinitionTypes'
import { terminalChoice } from '../../src/lib/macro/macroTerminalChoices'

const terminalChoices = [
  terminalChoice({ index: 1, type: 'shell' }),
  terminalChoice({ index: 2, type: 'text' }),
]

test('parallel lane pure policy preserves lookup, capability and lane-local output choices', () => {
  const draft = parallelDraft()
  const snapshot = structuredClone(draft)
  const node = findParallel(draft.body, 'parallel')!
  const shell = node.lanes[0]
  const text = node.lanes[1]

  expect(selectedParallelLane(node, 'missing')?.id).toBe('lane_shell')
  expect(expectedParallelTerminalTypeAt(draft, shell.terminal)).toBe('shell')
  expect(parallelLaneActionPaletteItems(shell, terminalChoices).map(({ type }) => type))
    .toEqual(['send', 'wait', 'capture-source', 'extract_text'])
  expect(parallelLaneActionPaletteItems(text, terminalChoices).map(({ type }) => type))
    .toEqual(['send', 'capture-source', 'extract_text'])
  expect(parallelLaneCaptureKinds(shell, terminalChoices)).toEqual(['terminal-buffer', 'agent-event'])
  expect(parallelLaneCaptureKinds(text, terminalChoices)).toEqual(['text-box'])
  expect(incompatibleParallelLaneActionIds(shell, 2, terminalChoices))
    .toEqual(['lane_wait', 'lane_capture'])
  expect(parallelLaneOutputSourceChoices(shell, 'lane_output').map(({ label }) => label))
    .toEqual(['lane_capture.captured_text', 'lane_extract.extracted_text'])
  expect(unavailableParallelLaneTerminalValues(node, 'lane_shell', terminalChoices, String))
    .toEqual(['2'])
  expect(unavailableParallelLaneTerminalValues(node, 'lane_text', terminalChoices, String))
    .toEqual(['1'])
  expect(parallelCollectsAnyLaneText(node)).toBe(false)
  expect(draft).toEqual(snapshot)
})

test('parallel lane commands preserve parent failure effects and final Output ordering', () => {
  const draft = parallelDraft()

  expectAtomicFailure(draft, () =>
    renameParallelLane(draft, 'parallel', 'lane_shell', 'lane_text'), 'duplicate_lane_id')
  expectAtomicFailure(draft, () =>
    renameParallelLaneAction(draft, 'parallel', 'lane_shell', 'lane_wait', 'reserved'), 'duplicate_node_id')
  expectAtomicFailure(draft, () =>
    setParallelLaneLabel(draft, 'parallel', 'lane_shell', ' text '), 'duplicate_lane_label')
  expectAtomicFailure(draft, () =>
    renameParallelLaneOutput(draft, 'parallel', 'lane_shell', 'lane_output', 'reserved'), 'duplicate_node_id')
  expectAtomicFailure(draft, () =>
    removeParallelLaneAction(draft, 'parallel', 'lane_shell', 'lane_output'), 'action_not_found')
  expectAtomicFailure(draft, () =>
    setParallelLaneCollectsText(draft, 'parallel', 'lane_text', true), 'artifact_source_unavailable')

  let adoptions = 0
  const blocked = expectAtomicFailure(draft, () => setParallelLaneTerminal(
    draft,
    'parallel',
    'lane_shell',
    { kind: 'terminal_index', index: 2 },
    terminalChoices,
    () => { adoptions += 1; return true },
  ), 'incompatible_lane_actions')
  expect(blocked.incompatibleActionIds).toEqual(['lane_wait', 'lane_capture'])
  expect(adoptions).toBe(1)
  expectAtomicFailure(draft, () => setParallelLaneTerminal(
    draft,
    'parallel',
    'lane_text',
    { kind: 'terminal_index', index: 2 },
    terminalChoices,
    () => { adoptions += 1; return false },
  ), 'terminal_adoption_failed')
  expect(adoptions).toBe(2)
  expect(setParallelLaneTerminal(
    draft,
    'parallel',
    'lane_text',
    { kind: 'terminal_index', index: 2 },
    terminalChoices,
    () => { adoptions += 1; return true },
  )).toEqual({ ok: true })
  expect(adoptions).toBe(3)

  const beforeMissingLane = draft.terminalLayout.length
  expect(setParallelLaneTerminal(
    draft,
    'parallel',
    'missing_lane',
    { kind: 'terminal_index', index: 3 },
    terminalChoices,
    (template) => {
      template.terminalLayout.push({ index: 3, type: 'shell' })
      return true
    },
  )).toEqual({ ok: false, reason: 'lane_not_found' })
  expect(draft.terminalLayout).toHaveLength(beforeMissingLane + 1)

  expect(setParallelLaneCollectsText(draft, 'parallel', 'lane_shell', true)).toEqual({ ok: true })
  const node = findParallel(draft.body, 'parallel')!
  const shell = node.lanes[0]
  expect(parallelLaneOutput(shell)?.source).toEqual({
    kind: 'step_artifact',
    stepId: 'lane_extract',
    artifact: 'extracted_text',
  })

  const added = addParallelLaneAction(
    draft,
    'parallel',
    'lane_shell',
    'send',
    terminalChoices,
    Number.MAX_SAFE_INTEGER,
  )
  expect(added.ok).toBe(true)
  if (!added.ok || !added.addedActionId) throw new Error('expected added lane action')
  expect(shell.body.at(-1)?.type).toBe('output')
  expect(shell.body.at(-2)?.id).toBe(added.addedActionId)
  expect(moveParallelLaneAction(draft, 'parallel', 'lane_shell', added.addedActionId, -1))
    .toEqual({ ok: true })
  expect(shell.body.at(-3)?.id).toBe(added.addedActionId)
  expect(renameParallelLaneAction(
    draft,
    'parallel',
    'lane_shell',
    added.addedActionId,
    'renamed_send',
  )).toEqual({ ok: true, renamed: { from: added.addedActionId, to: 'renamed_send' } })

  const laneAdded = addParallelLane(draft, 'parallel')
  expect(laneAdded).toEqual({ ok: true, addedLaneId: 'lane_3' })
  expect(node.lanes.at(-1)?.body.at(-1)?.type).toBe('output')
  const removed = removeParallelLane(draft, 'parallel', 'lane_shell')
  expect(removed.ok).toBe(true)
  if (!removed.ok) throw new Error('expected removed lane')
  expect(removed.removedActionIds).toEqual([
    'lane_wait',
    'lane_capture',
    'renamed_send',
    'lane_extract',
  ])
  expect(node.lanes.some((lane) => lane.id === 'lane_shell')).toBe(false)
})

function expectAtomicFailure(
  draft: MacroDefinitionV5,
  command: () => ParallelLaneCommandResult,
  reason: string,
): Extract<ParallelLaneCommandResult, { ok: false }> {
  const before = structuredClone(draft)
  const result = command()
  expect(result).toMatchObject({ ok: false, reason })
  expect(draft).toEqual(before)
  if (result.ok) throw new Error('expected failed command')
  return result
}

function parallelDraft(): MacroDefinitionV5 {
  return {
    schemaVersion: 5,
    name: 'Parallel policy',
    description: '',
    terminalLayout: [{ index: 1, type: 'shell' }, { index: 2, type: 'text' }],
    body: [
      { id: 'reserved', type: 'wait', mode: 'duration', durationMs: 1 },
      {
        id: 'parallel',
        type: 'parallel',
        lanes: [shellLane(), textLane()],
        merge: { kind: 'sectioned_text', separator: '\n', includeEmptyOutputs: false },
        onLaneFail: 'pause',
      } satisfies ParallelNode,
    ],
  }
}

function shellLane(): ParallelLane {
  return {
    id: 'lane_shell',
    label: 'shell',
    terminal: { kind: 'terminal_index', index: 1 },
    body: [
      { id: 'lane_wait', type: 'wait', mode: 'terminal-quiet', quietMs: 100, maxMs: 200, onTimeout: 'pause' },
      {
        id: 'lane_capture',
        type: 'capture-source',
        capture: { kind: 'terminal-buffer', mode: 'scrollback-tail', maxChars: 1000 },
      },
      {
        id: 'lane_extract',
        type: 'extract_text',
        source: { kind: 'step_artifact', stepId: 'lane_capture', artifact: 'captured_text' },
        split: { kind: 'lines', keepEmpty: false },
        filters: [],
        select: { mode: 'all' },
        extract: { kind: 'none' },
        trim: 'right',
        onEmpty: 'pause',
      },
      { id: 'lane_output', type: 'output', source: { kind: 'none' } },
    ],
  }
}

function textLane(): ParallelLane {
  return {
    id: 'lane_text',
    label: 'text',
    terminal: { kind: 'terminal_index', index: 2 },
    body: [{ id: 'text_output', type: 'output', source: { kind: 'none' } }],
  }
}
