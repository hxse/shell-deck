import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { normalizeParserOutput, serializeNormalizedSignals } from './parserResultSchema'
import { ParserInvocationError, type ParserInvocationContext, type ParserInvocationOutput, type ParserProfile } from './parserProfileTypes'

export type ExecCommandSpec = {
  command: string
  args: string[]
  stdin: string
  env: NodeJS.ProcessEnv
  signal?: AbortSignal
  timeoutMs?: number
}

export type ExecCommandResult = {
  exitCode: number
  stdout: string
  stderr: string
}

export type ExecCommandRunner = (spec: ExecCommandSpec) => Promise<ExecCommandResult>

export type CodexExecParserOptions = {
  command?: string
  runner?: ExecCommandRunner
  model?: string
  signal?: AbortSignal
  timeoutMs?: number
}

export async function runCodexExecParser(profile: ParserProfile, text: string, context: ParserInvocationContext, options: CodexExecParserOptions = {}): Promise<ParserInvocationOutput> {
  const tmp = mkdtempSync(join(tmpdir(), 'shell-deck-parser-'))
  const rawOutputPath = join(tmp, 'raw-output.json')
  try {
    const parserInput = buildParserInput(profile, text, context)
    const inputArtifactRef = await context.writeArtifact('parser-input', parserInput, 'txt')
    const command = options.command ?? 'codex'
    const args = [
      'exec',
      '--model', options.model ?? profile.model,
      '--sandbox', 'read-only',
      '--skip-git-repo-check',
      '--ephemeral',
      '--output-schema', profile.outputSchemaPath,
      '--output-last-message', rawOutputPath,
      '-',
    ]
    const runner = options.runner ?? defaultExecRunner
    const signal = options.signal ?? context.signal
    const timeoutMs = options.timeoutMs ?? Number(process.env.SHELL_DECK_PARSER_TIMEOUT_MS || 120000)
    const result = await runner({ command, args, stdin: parserInput, env: process.env, signal, timeoutMs })
    const rawText = existsSync(rawOutputPath) ? readFileSync(rawOutputPath, 'utf8') : result.stdout
    const rawArtifactRef = await context.writeArtifact('parser-ai-json-raw', rawText, 'txt')
    if (result.exitCode !== 0) {
      throw new ParserInvocationError('codex_exec_parser_failed', result.stderr.trim() || 'codex exec parser failed', { inputArtifactRef, rawArtifactRef, details: { exitCode: result.exitCode } })
    }
    let rawOutput: Record<string, unknown>
    try {
      rawOutput = JSON.parse(rawText || '{}') as Record<string, unknown>
    } catch (error) {
      throw new ParserInvocationError('invalid_ai_json_json', error instanceof Error ? error.message : 'invalid parser JSON', { rawArtifactRef, inputArtifactRef, details: { profileId: profile.profileId } })
    }
    const normalized = normalizeParserOutput(rawOutput, profile.signals, { allowStringBooleans: true })
    if (!normalized.ok || !normalized.signals) {
      throw new ParserInvocationError('invalid_ai_json_parser_output', normalized.issues.map((issue) => issue.path + ':' + issue.message).join('; '), { rawArtifactRef, inputArtifactRef, details: { profileId: profile.profileId, issues: normalized.issues } })
    }
    const normalizedArtifactRef = await context.writeArtifact('parser-normalized', serializeNormalizedSignals(normalized.signals), 'json')
    return {
      parserKind: 'ai-json',
      profileId: profile.profileId,
      signals: normalized.signals,
      rawArtifactRef,
      normalizedArtifactRef,
      inputArtifactRef,
      metadata: { adapter: 'codex-exec-one-shot', command, args, replicaIndex: context.replicaIndex ?? 0 },
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

export function buildParserInput(profile: ParserProfile, text: string, context: Pick<ParserInvocationContext, 'runId' | 'stepId' | 'captureArtifactRef'>): string {
  return [
    profile.prompt.trim(),
    '',
    'Output JSON Schema:',
    JSON.stringify(profile.outputSchema, null, 2),
    '',
    'Check set:',
    JSON.stringify(profile.checkSet, null, 2),
    '',
    'Run metadata:',
    JSON.stringify({ runId: context.runId, stepId: context.stepId, captureArtifactRef: context.captureArtifactRef }, null, 2),
    '',
    'Captured text:',
    text,
  ].join('\n')
}

async function defaultExecRunner(spec: ExecCommandSpec): Promise<ExecCommandResult> {
  return await new Promise((resolve, reject) => {
    const child = spawn(spec.command, spec.args, { env: spec.env, stdio: ['pipe', 'pipe', 'pipe'] })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    let killReason: string | null = null
    let killTimer: ReturnType<typeof setTimeout> | undefined
    const cleanup = () => {
      if (killTimer) clearTimeout(killTimer)
      spec.signal?.removeEventListener('abort', onAbort)
    }
    const kill = (reason: string) => {
      killReason = killReason ?? reason
      child.kill('SIGTERM')
      setTimeout(() => {
        if (child.exitCode === null) child.kill('SIGKILL')
      }, 2000).unref?.()
    }
    const onAbort = () => kill('aborted')
    if (spec.signal?.aborted) onAbort()
    else spec.signal?.addEventListener('abort', onAbort, { once: true })
    if (spec.timeoutMs && spec.timeoutMs > 0) killTimer = setTimeout(() => kill('timeout'), spec.timeoutMs)
    child.stdout.on('data', (chunk) => stdout.push(Buffer.from(chunk)))
    child.stderr.on('data', (chunk) => stderr.push(Buffer.from(chunk)))
    child.on('error', (error) => {
      cleanup()
      reject(error)
    })
    child.on('close', (code) => {
      cleanup()
      const suffix = killReason ? '\n' + killReason : ''
      resolve({ exitCode: code ?? (killReason ? 130 : 1), stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8') + suffix })
    })
    child.stdin.end(spec.stdin)
  })
}
