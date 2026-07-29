import { expect, test } from 'bun:test'
import {
  canMoveNodeToAnchor,
  ensureElseForIfNode,
  insertElifBranchAfter,
  insertNodeAtAnchor,
  moveNodeToAnchor,
  removeElseFromIfNode,
  resolveBodyPath,
  type BodyPath,
} from '../../src/lib/macro/flowV2EditorCommands'
import type { FlowV2IfBranch, FlowV2Node, MacroDefinitionV6 } from '../../src/lib/macro/macroDefinitionTypes'

test('V6 editor commands insert and move nodes through explicit body paths', () => {
  const definition = macro()
  expect(insertNodeAtAnchor(definition, { kind: 'inside', parentPath: [], index: 1, slot: 'for', anchorNodeId: 'loop' }, finish('inside')).ok).toBe(true)
  const loopPath: BodyPath = [{ kind: 'for', nodeId: 'loop' }]
  expect(resolveBodyPath(definition, loopPath)?.map((node) => node.id)).toEqual(['inside'])

  expect(canMoveNodeToAnchor(definition, 'send', { kind: 'after', parentPath: loopPath, index: 0, anchorNodeId: 'inside' })).toBe(true)
  expect(moveNodeToAnchor(definition, 'send', { kind: 'after', parentPath: loopPath, index: 0, anchorNodeId: 'inside' }).ok).toBe(true)
  expect(definition.body.map((node) => node.id)).toEqual(['if', 'loop'])
  expect(resolveBodyPath(definition, loopPath)?.map((node) => node.id)).toEqual(['inside', 'send'])
})

test('V6 if branches and optional bodies are explicit current-schema mutations', () => {
  const definition = macro()
  const branch: FlowV2IfBranch = { kind: 'elif', condition: condition('MAYBE'), body: [] }
  expect(insertElifBranchAfter(definition, { bodyPath: [], index: 1 }, 0, branch).reason).toBe('invalid_target')
  expect(insertElifBranchAfter(definition, { bodyPath: [], index: 0 }, 0, branch).ok).toBe(true)
  expect(ensureElseForIfNode(definition, { bodyPath: [], index: 0 }).ok).toBe(true)
  expect(insertNodeAtAnchor(definition, { kind: 'inside', parentPath: [], index: 0, slot: 'else', anchorNodeId: 'if' }, finish('else-finish')).ok).toBe(true)
  expect(resolveBodyPath(definition, [{ kind: 'if-else', nodeId: 'if' }])?.map((node) => node.id)).toEqual(['else-finish'])
  expect(removeElseFromIfNode(definition, { bodyPath: [], index: 0 }).ok).toBe(true)
})

test('control terminal bodies accept actions and reject nested flow controls', () => {
  const definition = macro()
  definition.body.push({ id: 'done', type: 'finish', reason: 'done' })
  const anchor = { kind: 'inside' as const, parentPath: [], index: 3, slot: 'control' as const, anchorNodeId: 'done' }
  expect(insertNodeAtAnchor(definition, anchor, send('before-finish')).ok).toBe(true)
  expect(insertNodeAtAnchor(definition, anchor, finish('nested-finish')).ok).toBe(false)
  expect(resolveBodyPath(definition, [{ kind: 'control', nodeId: 'done' }])?.map((node) => node.id)).toEqual(['before-finish'])
})

function macro(): MacroDefinitionV6 {
  return {
    schemaVersion: 6,
    name: 'Editor commands',
    description: '',
    terminalLayout: [{ index: 1, type: 'shell' }],
    body: [
      { id: 'if', type: 'if', branches: [{ kind: 'if', condition: condition('READY'), body: [] }] },
      { id: 'loop', type: 'for', range: { kind: 'count', count: 2 }, body: [] },
      send('send'),
    ],
  }
}

function condition(text: string) {
  return {
    kind: 'text_match' as const,
    source: { kind: 'step_artifact' as const, stepId: 'capture', artifact: 'captured_text' as const },
    matcher: { kind: 'simple' as const, op: 'contains' as const, text },
    scope: { kind: 'whole' as const },
  }
}

function send(id: string): FlowV2Node {
  return { id, type: 'send', terminal: { kind: 'terminal_index', index: 1 }, message: { parts: [{ kind: 'text', text: id }] }, delivery: 'auto', ending: 'cr' }
}

function finish(id: string): FlowV2Node { return { id, type: 'finish', reason: id } }
