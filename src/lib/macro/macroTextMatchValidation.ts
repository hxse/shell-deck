import { add, type ValidationContext } from './macroValidationContext'
import { exactKeys, literal, object, stringValue, validateRegex } from './macroValidationPrimitives'

export function validateFilterMatcher(value: unknown, path: string, context: ValidationContext): void {
  const matcher = object(value, context.issues, path)
  if (!matcher) return
  if (matcher.kind === 'simple') {
    exactKeys(matcher, ['kind', 'op', 'text'], context.issues, path)
    literal(matcher.op, ['contains', 'not_contains', 'equals', 'not_equals', 'starts_with', 'ends_with'], context.issues, `${path}.op`, 'unsupported simple match operation')
    stringValue(matcher.text, context.issues, `${path}.text`)
  } else if (matcher.kind === 'regex') {
    exactKeys(matcher, ['kind', 'pattern'], context.issues, path, ['flags'])
    validateRegex(matcher.pattern, matcher.flags, path, context)
  } else add(context.issues, 'invalid_literal', `${path}.kind`, 'matcher kind must be simple or regex')
}
