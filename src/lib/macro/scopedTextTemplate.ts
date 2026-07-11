import type { ScopedTemplateText, TemplatableScalarText } from "./templateTypes"

export const FOR_TEXT_TEMPLATE_TOKEN = "{{text}}"

export type TextTemplateBinding = {
  readonly text: string
  readonly forStepId: string
}

export function isScopedTemplateText(value: unknown): value is ScopedTemplateText {
  return Boolean(value) && typeof value === "object" && (value as { kind?: unknown }).kind === "template" && typeof (value as { template?: unknown }).template === "string"
}

export function scopedTemplateSyntaxIssue(template: string): string | null {
  if (!template.includes(FOR_TEXT_TEMPLATE_TOKEN)) return "template must contain exact {{text}} token"
  const remainder = template.replaceAll(FOR_TEXT_TEMPLATE_TOKEN, "")
  if (remainder.includes("{{") || remainder.includes("}}")) return "template only supports exact {{text}} token"
  return null
}

export function renderScopedTemplate(template: string, binding: TextTemplateBinding | undefined): string {
  if (!binding) throw new Error("missing_template_binding")
  const issue = scopedTemplateSyntaxIssue(template)
  if (issue) throw new Error("invalid_scoped_template:" + issue)
  return template.replaceAll(FOR_TEXT_TEMPLATE_TOKEN, () => binding.text)
}

export function renderTemplatableScalar(value: TemplatableScalarText, binding: TextTemplateBinding | undefined): string {
  return typeof value === "string" ? value : renderScopedTemplate(value.template, binding)
}
