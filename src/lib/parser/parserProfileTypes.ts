import type { BranchOperator } from '../macro/templateTypes'
import type { SignalSummary, SignalType } from '../macro/profileCatalogSummary'

export const PARSER_KINDS = ['ai-json', 'regex'] as const
export type ParserKind = typeof PARSER_KINDS[number]
export type ParserSignalValue = boolean | null
export type ParserSignals = Record<string, ParserSignalValue>

export type ParserCheckSet = {
  checkSetId: string
  checks: string[]
}

export type ParserFixture = {
  fixtureId: string
  input: string
  rawOutput: Record<string, unknown>
  expectedSignals: ParserSignals
}

export type ParserProfileManifest = {
  profileId: string
  profileVersion: number
  parserKind: 'ai-json'
  model: string
  invocation: 'codex-exec-one-shot'
  promptId: string
  promptVersion: number
  schemaId: string
  schemaVersion: number
  checkSetId: string
  signals: SignalSummary[]
  branchOperators: BranchOperator[]
  fixtures: string[]
  replicas?: 1 | 2
  replicaStrategy?: 'agree_or_pause'
}

export type ParserProfile = ParserProfileManifest & {
  prompt: string
  outputSchema: Record<string, unknown>
  outputSchemaPath: string
  checkSet: ParserCheckSet
  fixtureRecords: ParserFixture[]
}

export type ParserValidationIssue = {
  path: string
  message: string
}

export type ParserValidationResult = {
  ok: boolean
  issues: ParserValidationIssue[]
}

export type ParserArtifactWriter = {
  writeArtifact(prefix: string, content: string, extension?: string): Promise<string>
}

export type ParserInvocationContext = ParserArtifactWriter & {
  configId: string
  runId: string
  stepId: string
  captureArtifactRef: string
  replicaIndex?: number
  signal?: AbortSignal
}

export type ParserInvocationOutput = {
  parserKind: ParserKind
  signals: ParserSignals
  rawArtifactRef: string
  normalizedArtifactRef: string
  inputArtifactRef?: string
  profileId?: string
  metadata: Record<string, unknown>
}

export type ParserDisagreement = {
  status: 'disagreement'
  profileId: string
  strategy: 'agree_or_pause'
  variants: ParserInvocationOutput[]
}

export type ParserRuntimeOutput =
  | ({ status: 'ok' } & ParserInvocationOutput)
  | ParserDisagreement

export function signalTypeName(type: SignalType): SignalType {
  return type
}

export type ParserInvocationErrorMetadata = {
  code: string
  rawArtifactRef?: string
  inputArtifactRef?: string
  details?: Record<string, unknown>
}

export class ParserInvocationError extends Error {
  readonly code: string
  readonly rawArtifactRef?: string
  readonly inputArtifactRef?: string
  readonly details?: Record<string, unknown>

  constructor(code: string, message: string, metadata: Omit<ParserInvocationErrorMetadata, 'code'> = {}) {
    super(code + ':' + message)
    this.name = 'ParserInvocationError'
    this.code = code
    this.rawArtifactRef = metadata.rawArtifactRef
    this.inputArtifactRef = metadata.inputArtifactRef
    this.details = metadata.details
  }
}

export function parserInvocationErrorMetadata(error: unknown): ParserInvocationErrorMetadata | null {
  if (!(error instanceof ParserInvocationError)) return null
  return {
    code: error.code,
    ...(error.rawArtifactRef ? { rawArtifactRef: error.rawArtifactRef } : {}),
    ...(error.inputArtifactRef ? { inputArtifactRef: error.inputArtifactRef } : {}),
    ...(error.details ? { details: error.details } : {}),
  }
}
