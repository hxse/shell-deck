import { describe, expect, test } from 'bun:test'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  artifactChoicesBefore,
  artifactSourceFromKey,
  artifactSourceKey,
  laneArtifactChoices,
  parallelMessageChoices,
} from '../../src/lib/macro/macroArtifactChoices'
import {
  defaultCaptureSource,
  defaultFlowNode,
  defaultParallelLane,
  defaultParallelLaneAction,
  defaultTextFilter,
  nextParallelLaneId,
} from '../../src/lib/macro/macroEditorDefaults'
import type { FlowV2Node, MacroDefinitionV6, ParallelLane } from '../../src/lib/macro/macroDefinitionTypes'

describe('Macro flow visual editor extraction', () => {
  test('palette lifecycle and editor controllers have one owner without draft duplication', () => {
    const sourceRoot = resolve(import.meta.dir, '../../src')
    const componentRoot = resolve(sourceRoot, 'lib/components/macro')
    const palette = readFileSync(resolve(componentRoot, 'MacroInsertionPalette.svelte'), 'utf8')
    const flow = readFileSync(resolve(componentRoot, 'MacroFlowNodeList.svelte'), 'utf8')
    const lanes = readFileSync(resolve(componentRoot, 'ParallelLaneTabs.svelte'), 'utf8')
    const insertion = readFileSync(
      resolve(componentRoot, 'macroFlowInsertionController.svelte.ts'),
      'utf8',
    )
    const tree = readFileSync(resolve(componentRoot, 'macroFlowTreeController.svelte.ts'), 'utf8')
    const laneController = readFileSync(resolve(componentRoot, 'parallelLaneEditorController.svelte.ts'), 'utf8')
    const lanePolicy = readFileSync(resolve(componentRoot, 'parallelLaneEditorPolicy.ts'), 'utf8')
    const laneCommands = readFileSync(resolve(componentRoot, 'parallelLaneEditorCommands.ts'), 'utf8')
    const setLaneActionIdSource = laneController.slice(
      laneController.indexOf('  function setLaneActionId('),
      laneController.indexOf('  function isLaneActionCollapsed('),
    )
    const productionConsumers = sourceFiles(sourceRoot)
      .filter((path) => !path.endsWith('/MacroFlowNodeList.svelte') && !path.endsWith('/ParallelLaneTabs.svelte'))
      .filter((path) => /from ['"][^'"]*(?:macroFlowTreeController|parallelLaneEditorController)\.svelte['"]/.test(
        readFileSync(path, 'utf8'),
      ))
    const commandConsumers = sourceFiles(sourceRoot)
      .filter((path) => /from ['"][^'"]*parallelLaneEditorCommands['"]/.test(readFileSync(path, 'utf8')))
      .map(fileName)
    const policyConsumers = sourceFiles(sourceRoot)
      .filter((path) => /from ['"][^'"]*parallelLaneEditorPolicy['"]/.test(readFileSync(path, 'utf8')))
      .map(fileName)
    const insertionConsumers = sourceFiles(sourceRoot)
      .filter((path) => /from ['"][^'"]*macroFlowInsertionController\.svelte['"]/.test(
        readFileSync(path, 'utf8'),
      ))
      .map(fileName)

    expect(productionConsumers).toEqual([])
    expect(insertionConsumers).toEqual(['MacroFlowNodeList.svelte'])
    expect(commandConsumers).toEqual(['parallelLaneEditorController.svelte.ts'])
    expect(policyConsumers).toEqual([
      'parallelLaneEditorCommands.ts',
      'parallelLaneEditorController.svelte.ts',
    ])
    expect(flow).toContain('createMacroFlowTreeController')
    expect(flow).toContain('createMacroFlowInsertionController')
    expect(lanes).toContain('createParallelLaneEditorController')
    expect(lanes).toContain('const terminalUsageIndex = $derived')
    expect(lanes.match(/buildParallelTerminalUsage\(parallelNode/g)).toHaveLength(1)
    expect(laneController).toContain('options.terminalUsageIndex()')
    expect(flow).toContain('new MacroInsertionPaletteLifecycle')
    expect(insertion).not.toContain('new MacroInsertionPaletteLifecycle')
    expect(insertion).toContain('const lifecycle = options.lifecycle')
    expect(lanes).toContain('new MacroInsertionPaletteLifecycle')
    expect(flow + insertion + lanes).not.toContain('estimatedHalfWidth')
    expect(palette.match(/estimatedHalfWidth/g)).toHaveLength(3)
    expect((palette + flow + insertion + lanes).match(/getBoundingClientRect\(\)/g)).toHaveLength(2)
    expect(flow + insertion + lanes).not.toContain("event.key === 'Escape'")
    expect(flow + insertion + lanes).not.toContain("querySelector<HTMLElement>")
    expect(tree + insertion + laneController)
      .not.toMatch(/\$state\s*<\s*MacroDefinition|\$state\s*\(\s*options\.draft/)
    expect(tree + laneController).not.toMatch(/\blet\s+draft\b/)
    expect(tree).toContain('options.updateDraft')
    expect(insertion).toContain('options.updateDraft')
    expect(laneController).toContain('options.updateDraft')
    expect(flow.match(/\$state/g) ?? []).toHaveLength(0)
    expect(insertion.match(/\$state/g)).toHaveLength(8)
    expect(insertion).toContain('isInsertionAnchorValid(options.draft(), current)')
    expect(insertion).toContain('insertNodeAtAnchor(template, target, defaultFlowNode(template, type))')
    expect(insertion).toContain('moveNodeToAnchor(template, nodeId, target)')
    expect(insertion).toContain("notice = 'Insertion failed: ' + reason")
    expect(lanePolicy + laneCommands).not.toMatch(/\$state|options\.updateDraft|\bconfirm\(|editNotice/)
    expect(laneController.match(/\$state/g)).toHaveLength(2)
    expect(setLaneActionIdSource).toContain('collapsedLaneActionIds.includes(actionId)')
    expect(setLaneActionIdSource).toContain('result.ok')
    expect(setLaneActionIdSource).toContain('return result.ok')
    expect(laneController).toContain('collapsedLaneActionIds.filter((id) => !removed.has(id))')
    expect(laneController).toContain('options.setSelectedLaneId(result.addedLaneId)')
    for (const text of [
      'Duplicate lane id blocked: ',
      'Duplicate lane label blocked: ',
      'Duplicate action id blocked: ',
      'Target is already owned by an incompatible pane action.',
      'Target type is incompatible with this action.',
      'Remove parallel lane ',
      'Remove parallel lane action ',
    ]) expect(laneController).toContain(text)
    for (const source of [flow, insertion, laneController, lanePolicy, laneCommands]) {
      expect(source.trimEnd().split('\n').length).toBeLessThanOrEqual(400)
    }
  })

  test('default factory preserves the exact current node emitted by every root palette action', () => {
    const template = definition([{ id: 'send', type: 'wait', mode: 'duration', durationMs: 1 }])

    expect(defaultFlowNode(template, 'send')).toEqual({
      id: 'send_2', type: 'send', terminal: { kind: 'unassigned' }, message: { parts: [] }, delivery: 'auto', ending: 'cr',
    })
    expect(defaultFlowNode(template, 'notify')).toEqual({
      id: 'notify', type: 'notify', level: 'info', title: 'Macro notification', message: { parts: [] },
      channels: [{ kind: 'app', toast: true, sound: 'success', repeatCount: 3, repeatIntervalMs: 1000 }], onFailure: 'continue',
    })
    expect(defaultFlowNode(template, 'input')).toEqual({
      id: 'input', type: 'input', terminal: { kind: 'unassigned' }, prompt: 'Input', allowEmpty: false, delivery: 'auto', ending: 'cr',
    })
    expect(defaultFlowNode(template, 'wait')).toEqual({ id: 'wait', type: 'wait', mode: 'duration', durationMs: 1500 })
    expect(defaultFlowNode(template, 'capture-source')).toEqual({
      id: 'capture_source', type: 'capture-source',
      capture: { kind: 'terminal-buffer', terminal: { kind: 'unassigned' }, mode: 'scrollback-tail', maxChars: 20000 },
    })
    expect(defaultFlowNode(template, 'extract_text')).toEqual({
      id: 'extract_text', type: 'extract_text', source: { kind: 'unassigned' },
      split: { kind: 'lines', keepEmpty: false }, filters: [], select: { mode: 'all' },
      extract: { kind: 'none' }, trim: 'right', onEmpty: 'pause',
    })
    expect(defaultFlowNode(template, 'if')).toEqual({
      id: 'if', type: 'if', branches: [{
        kind: 'if',
        condition: {
          kind: 'text_match', source: { kind: 'unassigned' },
          matcher: { kind: 'simple', op: 'contains', text: 'READY' }, scope: { kind: 'whole' },
        },
        body: [],
      }],
    })
    expect(defaultFlowNode(template, 'for')).toEqual({ id: 'for', type: 'for', range: { kind: 'count', count: 1 }, body: [] })
    expect(defaultFlowNode(template, 'break')).toEqual({ id: 'break', type: 'break', reason: 'break', body: [] })
    expect(defaultFlowNode(template, 'continue')).toEqual({ id: 'continue', type: 'continue', reason: 'continue', body: [] })
    expect(defaultFlowNode(template, 'finish')).toEqual({ id: 'finish', type: 'finish', reason: 'done', body: [] })

    const parallel = defaultFlowNode(template, 'parallel')
    expect(parallel).toEqual({
      id: 'parallel', type: 'parallel',
      lanes: [{ id: 'lane_1', label: 'lane_1', body: [] }],
      sharedTextOrder: 'pane_order',
      onLaneFail: 'pause',
    })
  })

  test('lane/default field factories preserve ids, capture shape, and exact filter defaults', () => {
    const template = definition([])
    const lane = defaultParallelLane('lane_1')
    expect(lane).toEqual({ id: 'lane_1', label: 'lane_1', body: [] })
    expect(nextParallelLaneId([lane, { ...lane, id: 'lane_3' }])).toBe('lane_4')
    expect(defaultParallelLaneAction(template, 'send')).toEqual({
      id: 'send', type: 'send', terminal: { kind: 'unassigned' }, message: { parts: [] }, delivery: 'auto', ending: 'cr',
    })
    expect(defaultParallelLaneAction(template, 'wait')).toEqual({ id: 'wait', type: 'wait', mode: 'duration', durationMs: 1500 })
    expect(defaultParallelLaneAction(template, 'capture-source', 'agent-event')).toEqual({
      id: 'capture_source', type: 'capture-source',
      capture: { kind: 'agent-event', terminal: { kind: 'unassigned' }, agent: { kind: 'codex' }, captureMode: 'result_only', waitLimit: { kind: 'unbounded' } },
    })
    expect(defaultParallelLaneAction(template, 'extract_text')).toEqual({
      id: 'extract_text', type: 'extract_text', source: { kind: 'unassigned' },
      split: { kind: 'lines', keepEmpty: false }, filters: [], select: { mode: 'all' },
      extract: { kind: 'none' }, trim: 'right', onEmpty: 'pause',
    })
    expect(defaultCaptureSource('text-box', { kind: 'terminal_index', index: 1 })).toEqual({
      kind: 'text-box', terminal: { kind: 'terminal_index', index: 1 },
    })
    expect(defaultTextFilter()).toEqual({ kind: 'exclude', matcher: { kind: 'regex', pattern: '^\\s*[$#❯>]\\s*$' } })
  })

  test('artifact choices preserve root/branch and outer plus lane-local earlier order', () => {
    const target = extract('branch_target')
    const template = definition([
      capture('outer_capture'),
      {
        id: 'branch', type: 'if',
        branches: [{
          kind: 'if',
          condition: {
            kind: 'text_match', source: { kind: 'unassigned' },
            matcher: { kind: 'simple', op: 'contains', text: 'READY' }, scope: { kind: 'whole' },
          },
          body: [target],
        }],
      },
      parallel('outer_parallel'),
      extract('after_parallel'),
    ])

    expect(artifactChoicesBefore(template, 'branch_target').map((choice) => choice.label))
      .toEqual(['outer_capture.captured_text'])
    expect(artifactChoicesBefore(template, 'after_parallel').map((choice) => choice.label))
      .toEqual(['outer_capture.captured_text'])

    const lane: ParallelLane = {
      id: 'lane_1', label: 'lane',
      body: [
        { id: 'lane_capture', type: 'capture-source', capture: { kind: 'text-box', terminal: { kind: 'unassigned' } } },
        laneExtract('lane_extract'),
        { id: 'lane_send', type: 'send', terminal: { kind: 'unassigned' }, message: { parts: [] }, delivery: 'auto', ending: 'cr' },
      ],
    }
    const outer = artifactChoicesBefore(template, 'after_parallel')
    expect(laneArtifactChoices(lane, 'lane_send').map((choice) => choice.label))
      .toEqual(['lane_capture.captured_text', 'lane_extract.extracted_text'])
    expect(parallelMessageChoices(outer, lane, 'lane_send').map((choice) => choice.label))
      .toEqual([
        'outer_capture.captured_text',
        'lane_capture.captured_text',
        'lane_extract.extracted_text',
      ])
    expect(artifactSourceKey(artifactSourceFromKey('lane_extract:extracted_text'))).toBe('lane_extract:extracted_text')
    expect(artifactSourceFromKey('')).toEqual({ kind: 'unassigned' })
  })
})

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return /\.(?:ts|svelte)$/.test(entry.name) ? [path] : []
  })
}

function fileName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

function definition(body: FlowV2Node[]): MacroDefinitionV6 {
  return { schemaVersion: 6, name: 'Test', description: '', terminalLayout: [], body }
}

function capture(id: string): FlowV2Node {
  return {
    id, type: 'capture-source',
    capture: { kind: 'terminal-buffer', terminal: { kind: 'unassigned' }, mode: 'scrollback-tail', maxChars: 20000 },
  }
}

function extract(id: string): Extract<FlowV2Node, { type: 'extract_text' }> {
  return {
    id, type: 'extract_text', source: { kind: 'unassigned' }, split: { kind: 'lines', keepEmpty: false },
    filters: [], select: { mode: 'all' }, extract: { kind: 'none' }, trim: 'right', onEmpty: 'pause',
  }
}

function laneExtract(id: string): Extract<ParallelLane['body'][number], { type: 'extract_text' }> {
  return {
    id, type: 'extract_text', source: { kind: 'unassigned' }, split: { kind: 'lines', keepEmpty: false },
    filters: [], select: { mode: 'all' }, extract: { kind: 'none' }, trim: 'right', onEmpty: 'pause',
  }
}

function parallel(id: string): FlowV2Node {
  return {
    id, type: 'parallel', lanes: [{
      id: 'sibling_lane', label: 'sibling', body: [],
    }],
    sharedTextOrder: 'pane_order', onLaneFail: 'pause',
  }
}
