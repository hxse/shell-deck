import type {
  FlowV2ArtifactSource,
  FlowV2Node,
  FlowV2StepArtifactSource,
  MacroDefinitionV5,
  ParallelLane,
  ParallelOutputSource,
} from './macroDefinitionTypes'

export type ArtifactChoice = { label: string; source: FlowV2StepArtifactSource }

export function artifactChoicesBefore(
  template: MacroDefinitionV5,
  nodeId: string,
): ArtifactChoice[] {
  return collectArtifactChoicesBefore(template.body, nodeId, []).choices
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

export function assignedArtifactSourceFromKey(key: string): FlowV2StepArtifactSource | undefined {
  if (!key) return undefined
  const [stepId, artifact] = key.split(':')
  return {
    kind: 'step_artifact',
    stepId,
    artifact: artifact === 'merged_text'
      ? 'merged_text'
      : artifact === 'extracted_text'
        ? 'extracted_text'
        : 'captured_text',
  }
}

export function parallelOutputSourceKey(source: ParallelOutputSource): string {
  return source.kind === 'none' ? '' : artifactSourceKey(source)
}

export function parallelOutputSourceFromKey(key: string): ParallelOutputSource {
  return assignedArtifactSourceFromKey(key) ?? { kind: 'none' }
}

function collectArtifactChoicesBefore(
  nodes: FlowV2Node[],
  targetNodeId: string,
  visible: ArtifactChoice[],
): { choices: ArtifactChoice[]; found: boolean } {
  const choices = [...visible]
  for (const node of nodes) {
    if (node.id === targetNodeId) return { choices, found: true }
    if (node.type === 'if') {
      for (const branch of node.branches) {
        const result = collectArtifactChoicesBefore(branch.body, targetNodeId, choices)
        if (result.found) return result
      }
      if (node.else) {
        const result = collectArtifactChoicesBefore(node.else, targetNodeId, choices)
        if (result.found) return result
      }
    } else if (node.type === 'for') {
      const result = collectArtifactChoicesBefore(node.body, targetNodeId, choices)
      if (result.found) return result
    } else if (isControlTerminalNode(node) && node.body) {
      const result = collectArtifactChoicesBefore(node.body, targetNodeId, choices)
      if (result.found) return result
    }
    const output = artifactOutputForNode(node)
    if (output) choices.push(output)
  }
  return { choices, found: false }
}

function artifactOutputForNode(node: FlowV2Node): ArtifactChoice | null {
  if (node.type === 'capture-source') return artifactChoice(node.id, 'captured_text')
  if (node.type === 'parallel') return artifactChoice(node.id, 'merged_text')
  if (node.type === 'extract_text') return artifactChoice(node.id, 'extracted_text')
  return null
}

function artifactChoice(
  stepId: string,
  artifact: FlowV2StepArtifactSource['artifact'],
): ArtifactChoice {
  return {
    label: `${stepId}.${artifact}`,
    source: { kind: 'step_artifact', stepId, artifact },
  }
}

function isControlTerminalNode(
  node: FlowV2Node,
): node is Extract<FlowV2Node, { type: 'break' | 'continue' | 'finish' }> {
  return node.type === 'break' || node.type === 'continue' || node.type === 'finish'
}
