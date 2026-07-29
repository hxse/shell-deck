import { cloneJsonValue } from '../jsonClone'
import {
  parseAndValidateMacroDefinitionJson,
  parseAndValidateMacroTerminalLayoutFromDefinitionJson,
} from './macroDefinitionValidation'
import type { MacroDefinitionV6 } from './macroDefinitionTypes'

type ValidationIssue = { path: string; code?: string; message: string }
type JsonValidationFailure = {
  ok: false
  error: { code: string; message?: string; issues?: ValidationIssue[] }
}

export type MacroJsonCommit = {
  revision: number
  candidate: MacroDefinitionV6
}

export function createMacroJsonEditSession() {
  let editing = $state(false)
  let text = $state('')
  let revision = $state(0)
  let error = $state<string | null>(null)
  let pendingCommitRevision: number | null = null

  function open(definition: MacroDefinitionV6): void {
    text = JSON.stringify(definition, null, 2)
    editing = true
    revision += 1
    error = null
    pendingCommitRevision = null
  }

  function update(value: string, operationPending: boolean): void {
    if (operationPending) return
    text = value
    revision += 1
    error = null
  }

  function cancel(operationPending: boolean): void {
    if (operationPending) return
    editing = false
    error = null
    text = ''
    pendingCommitRevision = null
  }

  function clearSelection(): void {
    editing = false
    text = ''
    error = null
    pendingCommitRevision = null
  }

  function closeAfterRecordInstall(): void {
    editing = false
    error = null
    pendingCommitRevision = null
  }

  function beginCommit(): { ok: true; commit: MacroJsonCommit } | { ok: false } {
    const parsed = parseAndValidateMacroDefinitionJson(text)
    if (!parsed.ok) {
      error = formatMacroJsonValidation(parsed)
      return { ok: false }
    }
    const commit = { revision, candidate: cloneJsonValue(parsed.value) }
    pendingCommitRevision = revision
    return { ok: true, commit }
  }

  function finishCommit(commit: MacroJsonCommit): void {
    if (pendingCommitRevision === commit.revision) pendingCommitRevision = null
  }

  return {
    get editing() { return editing },
    get text() { return text },
    get revision() { return revision },
    get error() { return error },
    open,
    update,
    cancel,
    clearSelection,
    closeAfterRecordInstall,
    beginCommit,
    finishCommit,
    parseTerminalLayout: () => parseAndValidateMacroTerminalLayoutFromDefinitionJson(text),
    setError: (value: string | null) => { error = value },
  }
}

export type MacroJsonEditSession = ReturnType<typeof createMacroJsonEditSession>

export function formatMacroIssues(issues: ValidationIssue[]): string {
  return issues.map((issue) => `${issue.path || '<root>'}: ${issue.code ? `${issue.code}: ` : ''}${issue.message}`).join('\n')
}

export function formatMacroJsonValidation(result: JsonValidationFailure): string {
  return result.error.issues ? formatMacroIssues(result.error.issues) : result.error.message ?? result.error.code
}

export function formatMacroError(error: unknown): string {
  const response = error instanceof Error && 'response' in error
    ? (error as Error & { response?: { issues?: ValidationIssue[] } }).response
    : undefined
  return response?.issues ? formatMacroIssues(response.issues) : messageOf(error)
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
