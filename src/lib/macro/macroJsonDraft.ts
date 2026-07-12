import { validateMacroTemplate } from './templateSchema'
import type { MacroTemplate } from './templateTypes'

export type MacroJsonDraftContext = {
  templateId: string
  configId: string
  indexMap?: unknown[]
  terminals?: unknown[]
}

export type MacroJsonDraftResult =
  | { ok: true; template: MacroTemplate }
  | { ok: false; error: string }

export function parseMacroJsonDraft(text: string, context: MacroJsonDraftContext): MacroJsonDraftResult {
  let candidate: unknown
  try {
    candidate = JSON.parse(text)
  } catch (error) {
    return { ok: false, error: 'Invalid JSON: ' + errorMessage(error) }
  }

  const validation = validateMacroTemplate(candidate, {
    indexMap: context.indexMap,
    terminals: context.terminals,
  })
  if (!validation.ok) {
    return {
      ok: false,
      error: 'Invalid macro template:\n' + validation.issues.map((issue) => issue.path + ': ' + issue.message).join('\n'),
    }
  }

  const template = candidate as MacroTemplate
  if (template.id !== context.templateId) {
    return { ok: false, error: 'Template id cannot change while editing JSON.' }
  }
  if (template.configId !== context.configId) {
    return { ok: false, error: 'Template configId must match the current config.' }
  }
  return { ok: true, template }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
