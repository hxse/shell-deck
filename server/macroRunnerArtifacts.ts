import { canonicalJson, type JsonValue } from '../src/lib/macro/structuredJson'
import type { LiveRun } from './macroRunnerLiveState'
import type { MacroRunStore } from './macroRunStore'

type AppendEvent = (run: LiveRun, kind: string, data?: Record<string, unknown>) => void

export class MacroRunnerArtifacts {
  constructor(
    private readonly runStore: MacroRunStore,
    private readonly appendEvent: AppendEvent,
  ) {}

  persistText(
    run: LiveRun,
    stepId: string,
    name: string,
    value: string,
    prefix: string,
    data: Record<string, unknown> = {},
  ): string {
    const artifactRef = this.runStore.writeArtifact(run.runId, prefix, value)
    const outputs = run.artifacts.get(stepId) ?? new Map()
    outputs.set(name, { kind: 'text', value })
    run.artifacts.set(stepId, outputs)
    this.appendEvent(run, 'artifact_created', {
      stepId,
      artifact: name,
      artifactRef,
      chars: value.length,
      ...data,
    })
    return artifactRef
  }

  persistJson(
    run: LiveRun,
    stepId: string,
    name: string,
    value: JsonValue,
    prefix: string,
    data: Record<string, unknown> = {},
  ): string {
    const content = canonicalJson(value)
    const artifactRef = this.runStore.writeArtifact(run.runId, prefix, content, 'json')
    const outputs = run.artifacts.get(stepId) ?? new Map()
    outputs.set(name, { kind: 'json', value: structuredClone(value) })
    run.artifacts.set(stepId, outputs)
    this.appendEvent(run, 'artifact_created', {
      stepId,
      artifact: name,
      artifactRef,
      chars: content.length,
      ...data,
    })
    return artifactRef
  }

  writeSupplemental(
    run: LiveRun,
    stepId: string,
    artifact: string,
    prefix: string,
    value: string,
    extension = 'txt',
  ): string {
    const artifactRef = this.runStore.writeArtifact(run.runId, prefix, value, extension)
    this.appendEvent(run, 'artifact_created', {
      stepId,
      artifact,
      artifactRef,
      chars: value.length,
    })
    return artifactRef
  }
}
