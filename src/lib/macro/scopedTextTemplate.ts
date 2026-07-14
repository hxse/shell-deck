import type { ScopedTemplateText, TemplatableScalarText } from './macroDefinitionTypes'

export const LOOP_INDEX_TEMPLATE_TOKEN = "{{index}}"
export const LOOP_KEY_TEMPLATE_TOKEN = "{{key}}"
export const LOOP_VALUE_TEMPLATE_TOKEN = "{{value}}"
export const LOOP_TEMPLATE_TOKENS = [
  LOOP_INDEX_TEMPLATE_TOKEN,
  LOOP_KEY_TEMPLATE_TOKEN,
  LOOP_VALUE_TEMPLATE_TOKEN,
] as const

const LOOP_TEMPLATE_TOKEN_PATTERN = /\{\{(?:index|key|value)\}\}/g

export type TextListTemplateBinding = {
  readonly index: number
  readonly key: string
  readonly value: string
  readonly forStepId: string
}

export function isScopedTemplateText(value: unknown): value is ScopedTemplateText {
  return Boolean(value) && typeof value === "object" && (value as { kind?: unknown }).kind === "template" && typeof (value as { template?: unknown }).template === "string"
}

export function scopedTemplateSyntaxIssue(template: string): string | null {
  if (!LOOP_TEMPLATE_TOKENS.some((token) => template.includes(token))) {
    return "template must contain exact {{index}}, {{key}} or {{value}} token"
  }
  const remainder = template.replace(LOOP_TEMPLATE_TOKEN_PATTERN, "")
  if (remainder.includes("{{") || remainder.includes("}}")) {
    return "template only supports exact {{index}}, {{key}} and {{value}} tokens"
  }
  return null
}

export function renderScopedTemplate(template: string, binding: TextListTemplateBinding | undefined): string {
  if (!binding) throw new Error("missing_template_binding")
  const issue = scopedTemplateSyntaxIssue(template)
  if (issue) throw new Error("invalid_scoped_template:" + issue)
  return template.replace(LOOP_TEMPLATE_TOKEN_PATTERN, (token) => {
    if (token === LOOP_INDEX_TEMPLATE_TOKEN) return String(binding.index)
    if (token === LOOP_KEY_TEMPLATE_TOKEN) return binding.key
    return binding.value
  })
}

export function renderTemplatableScalar(value: TemplatableScalarText, binding: TextListTemplateBinding | undefined): string {
  return typeof value === "string" ? value : renderScopedTemplate(value.template, binding)
}
