import type {
  CaptureSourceConfig,
  FlowV2ArtifactSource,
  FlowV2JsonArtifactSource,
  FlowV2Node,
  JsonMatchCondition,
  MacroDefinitionV5,
  MacroTerminalReference,
  NotifyChannel,
  ParallelCaptureSourceConfig,
  ParallelLane,
  ParallelLaneActionNode,
  TextFilterSpec,
  TextMatchCondition,
} from './macroDefinitionTypes'

export function unassignedArtifactSource(): { kind: 'unassigned' } {
  return { kind: 'unassigned' }
}

export function defaultCaptureSource(
  kind: CaptureSourceConfig['kind'],
  terminal: MacroTerminalReference = { kind: 'unassigned' },
): CaptureSourceConfig {
  if (kind === 'agent-event') {
    return {
      kind,
      terminal,
      agent: { kind: 'codex' },
      captureMode: 'result_only',
      waitLimit: { kind: 'unbounded' },
    }
  }
  if (kind === 'structured-json') {
    return {
      kind,
      terminal,
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { decision: { type: 'string' } },
        required: ['decision'],
      },
      waitLimit: { kind: 'unbounded' },
    }
  }
  if (kind === 'text-box') return { kind, terminal }
  return { kind, terminal, mode: 'scrollback-tail', maxChars: 20000 }
}

export function defaultParallelCaptureSource(
  kind: ParallelCaptureSourceConfig['kind'],
): ParallelCaptureSourceConfig {
  const { terminal: _terminal, ...capture } = defaultCaptureSource(kind)
  return capture as ParallelCaptureSourceConfig
}

export function defaultTextMatchCondition(source: FlowV2ArtifactSource): TextMatchCondition {
  return {
    kind: 'text_match',
    source,
    matcher: { kind: 'simple', op: 'contains', text: 'READY' },
    scope: { kind: 'whole' },
  }
}

export function defaultJsonMatchCondition(source: FlowV2JsonArtifactSource): JsonMatchCondition {
  return {
    kind: 'json_match',
    source,
    pointer: '',
    matcher: { kind: 'exists' },
  }
}

export function defaultNotifyChannel(kind: NotifyChannel['kind']): NotifyChannel {
  if (kind === 'telegram') return { kind, profileId: 'default' }
  if (kind === 'system') return { kind }
  return { kind, toast: true, sound: 'success', repeatCount: 3, repeatIntervalMs: 1000 }
}

export function defaultTextFilter(): TextFilterSpec {
  return { kind: 'exclude', matcher: { kind: 'regex', pattern: '^\\s*[$#❯>]\\s*$' } }
}

export function defaultParallelLane(
  template: MacroDefinitionV5,
  rawId: string,
  terminal: MacroTerminalReference,
  existingLaneIds: string[] = [],
): ParallelLane {
  const ids = allMacroNodeIds(template.body)
  const id = uniqueMacroEditorKey(rawId, existingLaneIds)
  return {
    id,
    label: id,
    terminal,
    body: [{
      id: uniqueMacroEditorKey(`${id}_output`, [...ids, id]),
      type: 'output',
      source: { kind: 'none' },
    }],
  }
}

export function nextParallelLaneId(lanes: ParallelLane[]): string {
  const maxOrdinal = lanes.reduce((max, lane) => {
    const match = /^lane_(\d+)$/.exec(lane.id)
    return match ? Math.max(max, Number(match[1])) : max
  }, 0)
  const ordinal = maxOrdinal > 0 ? maxOrdinal + 1 : lanes.length + 1
  return uniqueMacroEditorKey(`lane_${ordinal}`, lanes.map((lane) => lane.id))
}

export function defaultFlowNode(
  template: MacroDefinitionV5,
  type: FlowV2Node['type'],
): FlowV2Node {
  const terminal: MacroTerminalReference = { kind: 'unassigned' }
  const id = uniqueMacroEditorKey(type.replace(/[^A-Za-z0-9_]/g, '_'), allMacroNodeIds(template.body))
  if (type === 'send') return { id, type, terminal, message: { parts: [] }, delivery: 'auto', ending: 'cr' }
  if (type === 'notify') {
    return {
      id,
      type,
      level: 'info',
      title: 'Macro notification',
      message: { parts: [] },
      channels: [defaultNotifyChannel('app')],
      onFailure: 'continue',
    }
  }
  if (type === 'input') return { id, type, terminal, prompt: 'Input', allowEmpty: false, delivery: 'auto', ending: 'cr' }
  if (type === 'wait') return { id, type, mode: 'duration', durationMs: 1500 }
  if (type === 'capture-source') return { id, type, capture: defaultCaptureSource('terminal-buffer', terminal) }
  if (type === 'extract_text') {
    return {
      id,
      type,
      source: unassignedArtifactSource(),
      split: { kind: 'lines', keepEmpty: false },
      filters: [],
      select: { mode: 'all' },
      extract: { kind: 'none' },
      trim: 'right',
      onEmpty: 'pause',
    }
  }
  if (type === 'parallel') {
    return {
      id,
      type,
      lanes: [defaultParallelLane(template, 'lane_1', terminal)],
      merge: {
        kind: 'sectioned_text',
        separator: '\n\n===== {laneId} | {laneLabel} | {terminalIndex} =====\n\n',
        includeEmptyOutputs: false,
      },
      onLaneFail: 'pause',
    }
  }
  if (type === 'if') {
    return {
      id,
      type,
      branches: [{
        kind: 'if',
        condition: defaultTextMatchCondition(unassignedArtifactSource()),
        body: [],
      }],
    }
  }
  if (type === 'for') return { id, type, range: { kind: 'count', count: 1 }, body: [] }
  if (type === 'break') return { id, type, reason: 'break', body: [] }
  if (type === 'continue') return { id, type, reason: 'continue', body: [] }
  return { id, type: 'finish', reason: 'done', body: [] }
}

export function defaultParallelLaneAction(
  template: MacroDefinitionV5,
  type: ParallelLaneActionNode['type'],
  captureKind: ParallelCaptureSourceConfig['kind'] = 'terminal-buffer',
): ParallelLaneActionNode {
  const id = uniqueMacroEditorKey(type.replace(/[^A-Za-z0-9_]/g, '_'), allMacroNodeIds(template.body))
  if (type === 'send') return { id, type, message: { parts: [] }, delivery: 'auto', ending: 'cr' }
  if (type === 'wait') return { id, type, mode: 'duration', durationMs: 1500 }
  if (type === 'capture-source') return { id, type, capture: defaultParallelCaptureSource(captureKind) }
  return {
    id,
    type,
    source: unassignedArtifactSource(),
    split: { kind: 'lines', keepEmpty: false },
    filters: [],
    select: { mode: 'all' },
    extract: { kind: 'none' },
    trim: 'right',
    onEmpty: 'pause',
  }
}

export function allMacroNodeIds(nodes: FlowV2Node[]): string[] {
  return nodes.flatMap((node) => {
    const nested = node.type === 'if'
      ? [
          ...node.branches.flatMap((branch) => allMacroNodeIds(branch.body)),
          ...(node.else ? allMacroNodeIds(node.else) : []),
        ]
      : node.type === 'for'
        ? allMacroNodeIds(node.body)
        : node.type === 'parallel'
          ? node.lanes.flatMap((lane) => lane.body.map((item) => item.id))
          : isControlTerminalNode(node) && node.body
            ? allMacroNodeIds(node.body)
            : []
    return [node.id, ...nested]
  })
}

export function uniqueMacroEditorKey(prefix: string, existing: string[]): string {
  const base = prefix.replace(/[^A-Za-z0-9_-]/g, '_').replace(/^[^A-Za-z0-9]+/, '') || 'node'
  let candidate = base
  for (let index = 2; existing.includes(candidate); index += 1) candidate = `${base}_${index}`
  return candidate
}

function isControlTerminalNode(
  node: FlowV2Node,
): node is Extract<FlowV2Node, { type: 'break' | 'continue' | 'finish' }> {
  return node.type === 'break' || node.type === 'continue' || node.type === 'finish'
}
