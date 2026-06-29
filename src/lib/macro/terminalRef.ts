import type { TerminalIndexMapItem } from '../protocol'
import { assertTerminalAlias, assertTerminalId } from '../terminalIdentity'
import type { TerminalTarget, ValidationIssue } from './templateTypes'

export function isTerminalTarget(value: unknown): value is TerminalTarget {
  if (!value || typeof value !== 'object') return false
  const ref = value as { kind?: unknown; value?: unknown }
  if (ref.kind === 'index') return Number.isInteger(ref.value) && Number(ref.value) >= 1
  if (ref.kind === 'id') return typeof ref.value === 'string'
  if (ref.kind === 'alias') return typeof ref.value === 'string'
  return false
}

export function validateTerminalTarget(path: string, value: unknown, indexMap?: TerminalIndexMapItem[]): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  if (!isTerminalTarget(value)) {
    return [{ path, message: 'terminal target must be {kind:"index"|"id"|"alias",value}' }]
  }
  if (value.kind === 'index') {
    if (indexMap && !indexMap.some((item) => item.index === value.value)) {
      issues.push({ path: path + '.value', message: 'terminal index is not present in current config' })
    }
    return issues
  }
  if (value.kind === 'id') {
    try {
      assertTerminalId(value.value)
    } catch {
      issues.push({ path: path + '.value', message: 'terminal id must use term_ public id format' })
    }
    if (indexMap && !indexMap.some((item) => item.terminalId === value.value)) {
      issues.push({ path: path + '.value', message: 'terminal id is not present in current config' })
    }
    return issues
  }
  try {
    assertTerminalAlias(value.value)
  } catch {
    issues.push({ path: path + '.value', message: 'terminal alias must match Identifier Contract' })
  }
  if (indexMap && !indexMap.some((item) => item.terminalAlias === value.value)) {
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
