import { expect, test } from "bun:test"
import {
  hasNonDefaultTextListItems,
  messageTextPartValue,
  templatableScalarValue,
  withMessagePartTemplateMode,
  withScalarTemplateMode,
} from "../../src/lib/macro/scopedTextTemplateEditor"

test("scalar template mode conversion preserves the exact draft text", () => {
  const literal = "  phase {{value}}\nnext  "
  const template = withScalarTemplateMode(literal, true)
  expect(template).toEqual({ kind: "template", template: literal })
  expect(templatableScalarValue(template)).toBe(literal)
  expect(withScalarTemplateMode(template, false)).toBe(literal)
})

test("message part template mode conversion is lossless and explicit", () => {
  const literal = { kind: "text" as const, text: "\n{{value}} and {{value}}\n" }
  const template = withMessagePartTemplateMode(literal, true)
  expect(template).toEqual({ kind: "template", template: literal.text })
  expect(messageTextPartValue(template)).toBe(literal.text)
  expect(withMessagePartTemplateMode(template, false)).toEqual(literal)
})

test("only the single empty key-value starter item is the default text-list draft", () => {
  expect(hasNonDefaultTextListItems([{ key: "", value: "" }])).toBe(false)
  expect(hasNonDefaultTextListItems([])).toBe(true)
  expect(hasNonDefaultTextListItems([{ key: " ", value: "" }])).toBe(true)
  expect(hasNonDefaultTextListItems([{ key: "", value: " " }])).toBe(true)
  expect(hasNonDefaultTextListItems([{ key: "", value: "" }, { key: "", value: "" }])).toBe(true)
})
