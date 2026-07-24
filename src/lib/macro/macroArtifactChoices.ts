import type {
  ArtifactName,
  FlowV2ArtifactSource,
  FlowV2JsonArtifactSource,
  FlowV2Node,
  FlowV2StepArtifactSource,
  FlowV2TextStepArtifactSource,
  MacroDefinitionV5,
  ParallelLane,
  ParallelOutputSource,
} from './macroDefinitionTypes'

export type ArtifactChoice = { label: string; source: FlowV2StepArtifactSource }
export type TextArtifactChoice = { label: string; source: FlowV2TextStepArtifactSource }
export type JsonArtifactChoice = { label: string; source: Extract<FlowV2StepArtifactSource, { artifact: 'captured_json' }> }
export type ArtifactChoiceIndex = {
  before(nodeId: string): ArtifactChoice[]
}

type ArtifactScope = {
  parent: ArtifactScope | null
  choice: ArtifactChoice | null
  cached: ArtifactChoice[] | null
}

export function buildArtifactChoiceIndex(template: MacroDefinitionV5): ArtifactChoiceIndex {
  const root: ArtifactScope = { parent: null, choice: null, cached: [] }
  const scopes = new Map<string, ArtifactScope>()
  indexArtifactScopes(template.body, root, scopes)
  return {
    before(nodeId) {
      const scope = scopes.get(nodeId)
      return scope ? materializeArtifactScope(scope) : []
    },
  }
}

export function artifactChoicesBefore(
  template: MacroDefinitionV5,
  nodeId: string,
): ArtifactChoice[] {
  return buildArtifactChoiceIndex(template).before(nodeId)
}

export function laneArtifactChoices(
  lane: ParallelLane,
  targetNodeId: string,
): ArtifactChoice[] {
  const choices: ArtifactChoice[] = []
  for (const item of lane.body) {
    if (item.id === targetNodeId) return choices
    if (item.type === 'capture-source') choices.push(artifactChoice(item.id, 'captured_text'))
    if (item.type === 'extract_text') choices.push(artifactChoice(item.id, 'extracted_text'))
  }
  return choices
}

export function textArtifactChoices(choices: ArtifactChoice[]): TextArtifactChoice[] {
  return choices.filter((choice): choice is TextArtifactChoice => choice.source.artifact !== 'captured_json')
}

export function jsonArtifactChoices(choices: ArtifactChoice[]): JsonArtifactChoice[] {
  return choices.filter((choice): choice is JsonArtifactChoice => choice.source.artifact === 'captured_json')
}

export function parallelMessageChoices(
  outerChoices: ArtifactChoice[],
  lane: ParallelLane,
  targetNodeId: string,
): ArtifactChoice[] {
  return [...outerChoices, ...laneArtifactChoices(lane, targetNodeId)]
}

export function artifactSourceKey(source?: FlowV2ArtifactSource): string {
  if (!source || source.kind === 'unassigned') return ''
  return `${source.stepId}:${source.artifact}`
}

export function artifactSourceFromKey(key: string): FlowV2ArtifactSource {
  return assignedArtifactSourceFromKey(key) ?? { kind: 'unassigned' }
}

export function jsonArtifactSourceFromKey(key: string): FlowV2JsonArtifactSource {
  const source = assignedArtifactSourceFromKey(key)
  return source?.artifact === 'captured_json' ? source : { kind: 'unassigned' }
}

export function assignedArtifactSourceFromKey(key: string): FlowV2StepArtifactSource | undefined {
  if (!key) return undefined
  const [stepId, artifact] = key.split(':')
  if (!stepId) return undefined
  const normalized: ArtifactName | undefined = artifact === 'captured_json'
    ? 'captured_json'
    : artifact === 'merged_text'
      ? 'merged_text'
      : artifact === 'extracted_text'
        ? 'extracted_text'
        : artifact === 'captured_text'
          ? 'captured_text'
          : undefined
  if (!normalized) return undefined
  return {
    kind: 'step_artifact',
    stepId,
    artifact: normalized,
  } as FlowV2StepArtifactSource
}

export function parallelOutputSourceKey(source: ParallelOutputSource): string {
  return source.kind === 'none' ? '' : artifactSourceKey(source)
}

export function parallelOutputSourceFromKey(key: string): ParallelOutputSource {
  const source = assignedArtifactSourceFromKey(key)
  return source && source.artifact !== 'captured_json' ? source : { kind: 'none' }
}

function indexArtifactScopes(
  nodes: FlowV2Node[],
  visible: ArtifactScope,
  scopes: Map<string, ArtifactScope>,
): void {
  let current = visible
  for (const node of nodes) {
    if (!scopes.has(node.id)) scopes.set(node.id, current)
    if (node.type === 'if') {
      for (const branch of node.branches) indexArtifactScopes(branch.body, current, scopes)
      if (node.else) indexArtifactScopes(node.else, current, scopes)
    } else if (node.type === 'for') {
      indexArtifactScopes(node.body, current, scopes)
    } else if (isControlTerminalNode(node) && node.body) {
      indexArtifactScopes(node.body, current, scopes)
    }
    const output = artifactOutputForNode(node)
    if (output) current = { parent: current, choice: output, cached: null }
  }
}

function materializeArtifactScope(scope: ArtifactScope): ArtifactChoice[] {
  if (scope.cached) return scope.cached
  const parent = scope.parent ? materializeArtifactScope(scope.parent) : []
  scope.cached = scope.choice ? [...parent, scope.choice] : parent
  return scope.cached
}

function artifactOutputForNode(node: FlowV2Node): ArtifactChoice | null {
  if (node.type === 'capture-source') {
    return artifactChoice(node.id, node.capture.kind === 'structured-json' ? 'captured_json' : 'captured_text')
  }
  if (node.type === 'parallel') return artifactChoice(node.id, 'merged_text')
  if (node.type === 'extract_text') return artifactChoice(node.id, 'extracted_text')
  return null
}

function artifactChoice(
  stepId: string,
  artifact: ArtifactName,
): ArtifactChoice {
  return {
    label: `${stepId}.${artifact}`,
    source: { kind: 'step_artifact', stepId, artifact } as FlowV2StepArtifactSource,
  }
}

function isControlTerminalNode(
  node: FlowV2Node,
): node is Extract<FlowV2Node, { type: 'break' | 'continue' | 'finish' }> {
  return node.type === 'break' || node.type === 'continue' || node.type === 'finish'
}
