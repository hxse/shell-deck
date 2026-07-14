import { expect, test } from 'bun:test'
import { writeFileSync } from 'node:fs'
import { runCodexExecParser, type ExecCommandRunner } from '../../src/lib/parser/codexExecParserAdapter'
import { loadParserProfile } from '../../src/lib/parser/parserProfileLoader'
import { ParserInvocationError, type ParserInvocationContext } from '../../src/lib/parser/parserProfileTypes'
import { createGeneratedId } from '../../src/lib/generatedId'

test('codex exec parser adapter uses one-shot schema constrained invocation', async () => {
  const profile = loadParserProfile('review-routing-v1')
  const artifacts = new Map<string, string>()
  const seen: { args?: string[]; stdin?: string } = {}
  const runner: ExecCommandRunner = async (spec) => {
    seen.args = spec.args
    seen.stdin = spec.stdin
    const outputPath = spec.args[spec.args.indexOf('--output-last-message') + 1]
    writeFileSync(outputPath, JSON.stringify({ hasAiFixable: true, needsUserDecision: 'false', onlyP3OrClean: false }))
    return { exitCode: 0, stdout: '', stderr: '' }
  }
  const context: ParserInvocationContext = {
    runId: createGeneratedId('run'),
    stepId: 'parse_review',
    captureArtifactRef: 'artifacts/capture.txt',
    writeArtifact: async (prefix, content, extension = 'txt') => {
      const ref = 'artifacts/' + prefix + '.' + extension
      artifacts.set(ref, content)
      return ref
    },
  }

  const result = await runCodexExecParser(profile, 'AI can directly fix this.', context, { runner })

  expect(seen.args).toContain('exec')
  expect(seen.args).toContain('--ephemeral')
  expect(seen.args).toContain('--output-schema')
  expect(seen.args).toContain('--output-last-message')
  expect(seen.args).not.toContain('resume')
  expect(seen.stdin).toContain('Captured text:')
  expect(seen.stdin).toContain('AI can directly fix this.')
  expect(result.signals).toEqual({ hasAiFixable: true, needsUserDecision: false, onlyP3OrClean: false })
  expect(artifacts.get(result.inputArtifactRef ?? '')).toContain('Output JSON Schema')
})

test('codex exec parser preserves raw output artifact on non-zero exit', async () => {
  const profile = loadParserProfile('review-routing-v1')
  const artifacts = new Map<string, string>()
  const runner: ExecCommandRunner = async (spec) => {
    const outputPath = spec.args[spec.args.indexOf('--output-last-message') + 1]
    writeFileSync(outputPath, '{\"hasAiFixable\": true}')
    return { exitCode: 2, stdout: '', stderr: 'schema failed' }
  }
  const context: ParserInvocationContext = {
    runId: createGeneratedId('run'),
    stepId: 'parse_review',
    captureArtifactRef: 'artifacts/capture.txt',
    writeArtifact: async (prefix, content, extension = 'txt') => {
      const ref = 'artifacts/' + prefix + '.' + extension
      artifacts.set(ref, content)
      return ref
    },
  }

  let error: unknown
  try {
    await runCodexExecParser(profile, 'schema failure with raw output', context, { runner })
  } catch (caught) {
    error = caught
  }

  expect(error).toBeInstanceOf(ParserInvocationError)
  const parserError = error as ParserInvocationError
  expect(parserError.code).toBe('codex_exec_parser_failed')
  expect(parserError.rawArtifactRef).toBe('artifacts/parser-ai-json-raw.txt')
  expect(artifacts.get(parserError.rawArtifactRef ?? '')).toBe('{\"hasAiFixable\": true}')
})

test('codex exec parser writes raw artifact even when output is empty', async () => {
  const profile = loadParserProfile('review-routing-v1')
  const artifacts = new Map<string, string>()
  const runner: ExecCommandRunner = async () => ({ exitCode: 0, stdout: '', stderr: '' })
  const context: ParserInvocationContext = {
    runId: createGeneratedId('run'),
    stepId: 'parse_review',
    captureArtifactRef: 'artifacts/capture.txt',
    writeArtifact: async (prefix, content, extension = 'txt') => {
      const ref = 'artifacts/' + prefix + '.' + extension
      artifacts.set(ref, content)
      return ref
    },
  }

  let error: unknown
  try {
    await runCodexExecParser(profile, 'empty output', context, { runner })
  } catch (caught) {
    error = caught
  }

  expect(error).toBeInstanceOf(ParserInvocationError)
  const parserError = error as ParserInvocationError
  expect(parserError.code).toBe('invalid_ai_json_parser_output')
  expect(parserError.rawArtifactRef).toBe('artifacts/parser-ai-json-raw.txt')
  expect(artifacts.get(parserError.rawArtifactRef ?? 'missing')).toBe('')
})

test('codex exec parser preserves raw output artifact before invalid JSON failure', async () => {
  const profile = loadParserProfile('review-routing-v1')
  const artifacts = new Map<string, string>()
  const runner: ExecCommandRunner = async (spec) => {
    const outputPath = spec.args[spec.args.indexOf('--output-last-message') + 1]
    writeFileSync(outputPath, '{not valid json')
    return { exitCode: 0, stdout: '', stderr: '' }
  }
  const context: ParserInvocationContext = {
    runId: createGeneratedId('run'),
    stepId: 'parse_review',
    captureArtifactRef: 'artifacts/capture.txt',
    writeArtifact: async (prefix, content, extension = 'txt') => {
      const ref = 'artifacts/' + prefix + '.' + extension
      artifacts.set(ref, content)
      return ref
    },
  }

  let error: unknown
  try {
    await runCodexExecParser(profile, 'bad model output', context, { runner })
  } catch (caught) {
    error = caught
  }

  expect(error).toBeInstanceOf(ParserInvocationError)
  const parserError = error as ParserInvocationError
  expect(parserError.code).toBe('invalid_ai_json_json')
  expect(parserError.rawArtifactRef).toBe('artifacts/parser-ai-json-raw.txt')
  expect(artifacts.get(parserError.rawArtifactRef ?? '')).toBe('{not valid json')
})
