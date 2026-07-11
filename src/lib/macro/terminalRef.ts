import type { TerminalIndexMapItem } from '../protocol'
import { assertTerminalAlias, assertTerminalId } from '../terminalIdentity'
import type { TerminalTarget, ValidationIssue } from './templateTypes'

const TERMINAL_TARGET_KEYS = new Set(['kind', 'value'])

export function isTerminalTarget(value: unknown): value is TerminalTarget {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const ref = value as { kind?: unknown; value?: unknown }
  const keys = Object.keys(value)
  if (keys.length !== TERMINAL_TARGET_KEYS.size || keys.some((key) => !TERMINAL_TARGET_KEYS.has(key))) return false
  if (!Object.prototype.hasOwnProperty.call(value, 'kind') || !Object.prototype.hasOwnProperty.call(value, 'value')) return false
  if (ref.kind === 'index') return Number.isInteger(ref.value) && Number(ref.value) >= 1
  if (ref.kind === 'id') return typeof ref.value === 'string'
  if (ref.kind === 'alias') return typeof ref.value === 'string'
  return false
}

export function validateTerminalTarget(path: string, value: unknown, indexMap?: TerminalIndexMapItem[]): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [{ path, message: 'terminal target must be {kind:"index"|"id"|"alias",value}' }]
  }
  const record = value as Record<string, unknown>
  for (const key of Object.keys(record)) {
    if (!TERMINAL_TARGET_KEYS.has(key)) issues.push({ path: path + '.' + key, message: 'extra terminal target field is not allowed' })
  }
  if (!Object.prototype.propertyIsEnumerable.call(record, 'kind') || !Object.prototype.propertyIsEnumerable.call(record, 'value')) {
    issues.push({ path, message: 'terminal target must own enumerable kind and value fields' })
    return issues
  }
  const ref = record as { kind: unknown; value: unknown }
  const validVariant = ref.kind === 'index'
    ? Number.isInteger(ref.value) && Number(ref.value) >= 1
    : (ref.kind === 'id' || ref.kind === 'alias') && typeof ref.value === 'string'
  if (!validVariant) {
    issues.push({ path, message: 'terminal target must be {kind:"index"|"id"|"alias",value}' })
    return issues
  }
  const target = record as TerminalTarget
  if (target.kind === 'index') {
    if (indexMap && !indexMap.some((item) => item.index === target.value)) {
      issues.push({ path: path + '.value', message: 'terminal index is not present in current config' })
    }
    return issues
  }
  if (target.kind === 'id') {
    try {
      assertTerminalId(target.value)
    } catch {
      issues.push({ path: path + '.value', message: 'terminal id must use term_ public id format' })
    }
    if (indexMap && !indexMap.some((item) => item.terminalId === target.value)) {
      issues.push({ path: path + '.value', message: 'terminal id is not present in current config' })
    }
    return issues
  }
  try {
    assertTerminalAlias(target.value)
  } catch {
    issues.push({ path: path + '.value', message: 'terminal alias must match Identifier Contract' })
  }
  if (indexMap && !indexMap.some((item) => item.terminalAlias === target.value)) {
    issues.push({ path: path + '.value', message: 'terminal alias is not present in current config' })
  }
  return issues
}

export function resolveTerminalTarget(value: TerminalTarget, indexMap: TerminalIndexMapItem[]): string {
  if (value.kind === 'id') {
    const found = indexMap.find((item) => item.terminalId === value.value)
    if (!found) throw new Error('terminal_id_not_in_config:' + value.value)
    return value.value
  }
  if (value.kind === 'alias') {
    const found = indexMap.find((item) => item.terminalAlias === value.value)
    if (!found) throw new Error('terminal_alias_not_in_config:' + value.value)
    return found.terminalId
  }
  const found = indexMap.find((item) => item.index === value.value)
  if (!found) throw new Error('terminal_index_not_in_config:' + value.value)
  return found.terminalId
}
