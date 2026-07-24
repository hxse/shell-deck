import Ajv2020, { type AnySchema, type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js'

export type JsonScalar = string | number | boolean | null
export type JsonValue = JsonScalar | JsonValue[] | { [key: string]: JsonValue }
export type JsonSchema = boolean | { [key: string]: JsonValue }

export type StructuredJsonValidationIssue = {
  path: string
  keyword: string
  message: string
}

export type StructuredJsonValidator = {
  validate(value: unknown): StructuredJsonValidationIssue[]
}

const SINGLE_SUBSCHEMA_KEYWORDS = [
  'additionalItems',
  'additionalProperties',
  'contains',
  'contentSchema',
  'else',
  'if',
  'items',
  'not',
  'propertyNames',
  'then',
  'unevaluatedItems',
  'unevaluatedProperties',
] as const

const ARRAY_SUBSCHEMA_KEYWORDS = ['allOf', 'anyOf', 'oneOf', 'prefixItems'] as const

const MAP_SUBSCHEMA_KEYWORDS = [
  '$defs',
  'definitions',
  'dependencies',
  'dependentSchemas',
  'patternProperties',
  'properties',
] as const

export function compileStructuredJsonSchema(
  schema: unknown,
): { ok: true; validator: StructuredJsonValidator } | { ok: false; message: string } {
  if (!isJsonSchema(schema)) return { ok: false, message: 'schema must be a JSON object or boolean' }
  const referenceIssue = validateLocalSchemaReferences(schema)
  if (referenceIssue) return { ok: false, message: referenceIssue }
  let validate: ValidateFunction
  try {
    validate = new Ajv2020({
      allErrors: true,
      strict: false,
      validateFormats: false,
    }).compile(schema as AnySchema)
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
  return {
    ok: true,
    validator: {
      validate(value: unknown): StructuredJsonValidationIssue[] {
        if (!isJsonValue(value)) {
          return [{ path: '', keyword: 'type', message: 'submitted value must be valid JSON' }]
        }
        return validate(value) ? [] : normalizeAjvIssues(validate.errors)
      },
    },
  }
}

export function isJsonSchema(value: unknown): value is JsonSchema {
  return typeof value === 'boolean' || (isJsonValue(value) && value !== null && typeof value === 'object' && !Array.isArray(value))
}

export function isJsonValue(value: unknown): value is JsonValue {
  return isJsonValueInner(value, new Set<object>())
}

export function validateJsonPointer(pointer: unknown): string | null {
  if (typeof pointer !== 'string') return 'JSON Pointer must be a string'
  if (pointer === '') return null
  if (!pointer.startsWith('/')) return 'JSON Pointer must be empty or start with /'
  for (const token of pointer.slice(1).split('/')) {
    for (let index = 0; index < token.length; index += 1) {
      if (token[index] !== '~') continue
      if (token[index + 1] !== '0' && token[index + 1] !== '1') return 'JSON Pointer only supports ~0 and ~1 escapes'
      index += 1
    }
  }
  return null
}

export function resolveJsonPointer(
  root: JsonValue,
  pointer: string,
): { found: true; value: JsonValue } | { found: false } {
  if (validateJsonPointer(pointer) !== null) return { found: false }
  if (pointer === '') return { found: true, value: root }
  let current: JsonValue = root
  for (const encoded of pointer.slice(1).split('/')) {
    const token = encoded.replaceAll('~1', '/').replaceAll('~0', '~')
    if (Array.isArray(current)) {
      if (!/^(0|[1-9][0-9]*)$/.test(token)) return { found: false }
      const index = Number(token)
      if (index >= current.length) return { found: false }
      current = current[index]!
      continue
    }
    if (current === null || typeof current !== 'object' || !Object.prototype.hasOwnProperty.call(current, token)) {
      return { found: false }
    }
    current = current[token]!
  }
  return { found: true, value: current }
}

export function canonicalJson(value: JsonValue): string {
  return JSON.stringify(sortJsonKeys(value), null, 2) + '\n'
}

export function compactCanonicalJson(value: JsonValue): string {
  return JSON.stringify(sortJsonKeys(value))
}

export function structuredJsonSubmissionPrompt(schema: JsonSchema): string {
  return [
    '',
    '------------',
    '',
    '完成任务后，请生成一份符合下方 JSON Schema 的 JSON。不要只把 JSON 写在最终回复中。',
    '请使用 terminal tool 按以下形式执行命令，通过 stdin 提交结果。执行前必须把占位行替换为实际 JSON，不要原样提交占位内容：',
    '',
    "just -f \"$SHELL_DECK_JUSTFILE\" submit-json <<'SHELL_DECK_JSON'",
    '<替换为符合 Schema 的实际 JSON>',
    'SHELL_DECK_JSON',
    '',
    '提交的 JSON 必须符合以下 JSON Schema：',
    '',
    JSON.stringify(schema, null, 2),
    '',
    '命令输出 structured_json_submitted 才算提交成功。',
    '如果返回 structured_json_schema_mismatch，请根据 issues 修正 JSON 后重新提交。',
    '',
    '------------',
    '',
  ].join('\n')
}

function isJsonValueInner(value: unknown, ancestors: Set<object>): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value !== 'object') return false
  if (ancestors.has(value)) return false
  ancestors.add(value)
  const valid = Array.isArray(value)
    ? value.every((item) => isJsonValueInner(item, ancestors))
    : Object.values(value).every((item) => isJsonValueInner(item, ancestors))
  ancestors.delete(value)
  return valid
}

function normalizeAjvIssues(errors: ErrorObject[] | null | undefined): StructuredJsonValidationIssue[] {
  return [...(errors ?? [])]
    .map((error) => ({
      path: error.instancePath,
      keyword: error.keyword,
      message: error.message ?? 'JSON Schema validation failed',
    }))
    .sort((left, right) => (
      compareCodePoints(left.path, right.path)
      || compareCodePoints(left.keyword, right.keyword)
      || compareCodePoints(left.message, right.message)
    ))
}

function validateLocalSchemaReferences(schema: JsonSchema): string | null {
  const pending: JsonSchema[] = [schema]
  while (pending.length > 0) {
    const current = pending.pop()!
    if (typeof current === 'boolean') continue
    for (const keyword of ['$ref', '$dynamicRef'] as const) {
      const reference = current[keyword]
      if (
        Object.prototype.hasOwnProperty.call(current, keyword)
        && (typeof reference !== 'string' || !reference.startsWith('#'))
      ) {
        return `${keyword} must use a local fragment`
      }
    }

    for (const keyword of SINGLE_SUBSCHEMA_KEYWORDS) {
      enqueueSubschema(current[keyword], pending)
    }
    for (const keyword of ARRAY_SUBSCHEMA_KEYWORDS) {
      const children = current[keyword]
      if (Array.isArray(children)) {
        for (const child of children) enqueueSubschema(child, pending)
      }
    }
    for (const keyword of MAP_SUBSCHEMA_KEYWORDS) {
      const children = current[keyword]
      if (children && typeof children === 'object' && !Array.isArray(children)) {
        for (const child of Object.values(children)) enqueueSubschema(child, pending)
      }
    }
  }
  return null
}

function enqueueSubschema(value: JsonValue | undefined, pending: JsonSchema[]): void {
  if (
    typeof value === 'boolean'
    || (value !== null && typeof value === 'object' && !Array.isArray(value))
  ) {
    pending.push(value)
  }
}

function sortJsonKeys(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(sortJsonKeys)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.keys(value)
      .sort(compareCodePoints)
      .map((key) => [key, sortJsonKeys(value[key]!)]),
  )
}

function compareCodePoints(left: string, right: string): number {
  const leftPoints = [...left].map((character) => character.codePointAt(0)!)
  const rightPoints = [...right].map((character) => character.codePointAt(0)!)
  for (let index = 0; index < Math.min(leftPoints.length, rightPoints.length); index += 1) {
    if (leftPoints[index] !== rightPoints[index]) return leftPoints[index] - rightPoints[index]
  }
  return leftPoints.length - rightPoints.length
}
