import type { MessagePart, ScopedTemplateText, TemplatableScalarText, TextListItem } from './macroDefinitionTypes'

export type TextTemplateScope = {
  forStepId: string
  shadowedForStepId?: string
}

export function templatableScalarValue(value: TemplatableScalarText): string {
  return typeof value === "string" ? value : value.template
}

export function withScalarTemplateMode(value: TemplatableScalarText, enabled: boolean): TemplatableScalarText {
  const text = templatableScalarValue(value)
  return enabled ? { kind: "template", template: text } : text
}

export function messageTextPartValue(part: Extract<MessagePart, { kind: "text" | "template" }>): string {
  return part.kind === "template" ? part.template : part.text
}

export function withMessagePartTemplateMode(
  part: Extract<MessagePart, { kind: "text" | "template" }>,
  enabled: boolean,
): Extract<MessagePart, { kind: "text" | "template" }> {
  const text = messageTextPartValue(part)
  return enabled ? ({ kind: "template", template: text } satisfies ScopedTemplateText) : { kind: "text", text }
}

export function hasNonDefaultTextListItems(items: readonly TextListItem[]): boolean {
  return items.length !== 1 || items[0]?.key !== "" || items[0]?.value !== ""
}
