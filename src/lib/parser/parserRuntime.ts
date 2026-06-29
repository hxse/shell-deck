import type { ParserConfig } from '../macro/templateTypes'
import { RunEventStore } from '../runLog/runEventStore'
import { runCodexExecParser, type CodexExecParserOptions } from './codexExecParserAdapter'
import { loadParserProfile } from './parserProfileLoader'
import { ParserInvocationError, type ParserInvocationContext, type ParserInvocationOutput, type ParserProfile, type ParserRuntimeOutput } from './parserProfileTypes'
import { reduceParserReplicas } from './replicaReducer'
import { runMockAiJsonParser } from './mockParserAdapter'
import { runRegexParser } from './regexParserAdapter'

export type AiJsonAdapter = (profile: ParserProfile, text: string, context: ParserInvocationContext, replicaIndex: number) => Promise<ParserInvocationOutput>
export type AiJsonParserMode = 'disabled' | 'mock' | 'codex-exec'

export type ParserRuntimeOptions = {
  profileRoot?: string
  aiJsonMode?: AiJsonParserMode
  aiJsonAdapter?: AiJsonAdapter
  codexExec?: CodexExecParserOptions
}

export type ParserRuntimeRequest = {
  configId: string
  runId: string
  stepId: string
  captureArtifactRef: string
  parser: ParserConfig
  text: string
  signal?: AbortSignal
}

export class ParserRuntime {
  constructor(private readonly runEventStore: RunEventStore, private readonly options: ParserRuntimeOptions = {}) {}

  optionsLabel(): AiJsonParserMode {
    if (this.options.aiJsonAdapter) return 'mock'
    return this.options.aiJsonMode ?? 'disabled'
  }

  async parse(request: ParserRuntimeRequest): Promise<ParserRuntimeOutput> {
    const contextFor = (replicaIndex?: number): ParserInvocationContext => ({
      configId: request.configId,
      runId: request.runId,
      stepId: request.stepId,
      captureArtifactRef: request.captureArtifactRef,
      replicaIndex,
      signal: request.signal,
      writeArtifact: async (prefix, content, extension = 'txt') => {
        return (await this.runEventStore.writeArtifact(request.configId, request.runId, prefix, content, extension, request.stepId)).artifact.artifactRef
      },
    })

    if (request.parser.kind === 'regex') {
      const output = await runRegexParser(request.parser.rules, request.text, contextFor())
      return { status: 'ok', ...output }
    }

    const profile = loadParserProfile(request.parser.profileId, this.options.profileRoot)
    const replicas = profile.replicas ?? 1
    const variants: ParserInvocationOutput[] = []
    for (let index = 0; index < replicas; index += 1) {
      variants.push(await this.runAiJson(profile, request.text, contextFor(index), index))
    }
    const reduced = reduceParserReplicas(profile.profileId, variants, profile.replicaStrategy ?? 'agree_or_pause')
    if ('status' in reduced && reduced.status === 'disagreement') return reduced
    return { status: 'ok', ...reduced }
  }

  private async runAiJson(profile: ParserProfile, text: string, context: ParserInvocationContext, replicaIndex: number): Promise<ParserInvocationOutput> {
    if (this.options.aiJsonAdapter) return await this.options.aiJsonAdapter(profile, text, context, replicaIndex)
    const mode = this.options.aiJsonMode ?? 'disabled'
    if (mode === 'codex-exec') return await runCodexExecParser(profile, text, context, this.options.codexExec)
    if (mode === 'mock') return await runMockAiJsonParser(profile, text, context)
    throw new ParserInvocationError('ai_json_adapter_not_configured', 'ai-json parser requires explicit --ai-json-parser=codex-exec or a mock dev/test entry', { details: { profileId: profile.profileId } })
  }
}
