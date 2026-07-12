import { expect, test } from 'bun:test'
import { parseMacroJsonDraft } from '../../src/lib/macro/macroJsonDraft'
import type { MacroTemplate } from '../../src/lib/macro/templateTypes'

test('macro JSON draft accepts an exact current template with stable identity', () => {
  const template = currentTemplate()
  expect(parseMacroJsonDraft(JSON.stringify(template), {
    templateId: template.id,
    configId: template.configId,
  })).toEqual({ ok: true, template })
})

test('macro JSON draft reports malformed JSON without fabricating a template', () => {
  const result = parseMacroJsonDraft('{', {
    templateId: 'tmpl_json_edit',
    configId: 'local',
  })
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.error).toStartWith('Invalid JSON:')
})

test('macro JSON draft rejects invalid and extra-field schema shapes', () => {
  const template = { ...currentTemplate(), legacy: true }
  const result = parseMacroJsonDraft(JSON.stringify(template), {
    templateId: template.id,
    configId: template.configId,
  })
  expect(result.ok).toBe(false)
  if (!result.ok) {
    expect(result.error).toStartWith('Invalid macro template:')
    expect(result.error).toContain('legacy')
  }
})

test('macro JSON draft rejects template id and config id changes', () => {
  const template = currentTemplate()
  const changedId = parseMacroJsonDraft(JSON.stringify({ ...template, id: 'tmpl_other' }), {
    templateId: template.id,
    configId: template.configId,
  })
  expect(changedId).toEqual({ ok: false, error: 'Template id cannot change while editing JSON.' })

  const changedConfig = parseMacroJsonDraft(JSON.stringify({ ...template, configId: 'other' }), {
    templateId: template.id,
    configId: template.configId,
  })
  expect(changedConfig).toEqual({ ok: false, error: 'Template configId must match the current config.' })
})

function currentTemplate(): MacroTemplate {
  return {
    schemaVersion: 2,
    id: 'tmpl_json_edit',
    name: 'JSON Edit',
    description: '',
    configId: 'local',
    body: [],
    createdAt: '2026-07-12T00:00:00.000Z',
    updatedAt: '2026-07-12T00:00:00.000Z',
  }
}
