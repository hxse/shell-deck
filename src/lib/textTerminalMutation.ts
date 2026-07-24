export type TextTerminalMutation =
  | { kind: 'patch'; start: number; deleteCount: number; insert: string }
  | { kind: 'replace'; content: string }

export function createTextTerminalMutation(base: string, candidate: string): TextTerminalMutation {
  if (base === candidate) return { kind: 'patch', start: base.length, deleteCount: 0, insert: '' }
  let prefix = commonPrefixLength(base, candidate)
  if (isSurrogateBoundary(base, prefix) || isSurrogateBoundary(candidate, prefix)) prefix -= 1
  let suffix = commonSuffixLength(base, candidate, prefix)
  while (suffix > 0 && (
    isSurrogateBoundary(base, base.length - suffix)
      || isSurrogateBoundary(candidate, candidate.length - suffix)
  )) suffix -= 1
  const patch: TextTerminalMutation = {
    kind: 'patch',
    start: prefix,
    deleteCount: base.length - prefix - suffix,
    insert: candidate.slice(prefix, candidate.length - suffix),
  }
  const replace: TextTerminalMutation = { kind: 'replace', content: candidate }
  const changedSpan = Math.max(patch.deleteCount, patch.insert.length)
  const fullSpan = Math.max(base.length, candidate.length, 1)
  return JSON.stringify(patch).length >= JSON.stringify(replace).length
    || changedSpan / fullSpan >= 0.75
    ? replace
    : patch
}

export function applyTextTerminalMutation(base: string, mutation: TextTerminalMutation): string {
  if (mutation.kind === 'replace') return mutation.content
  if (!Number.isInteger(mutation.start) || mutation.start < 0 || mutation.start > base.length) {
    throw new Error('invalid_text_patch')
  }
  if (!Number.isInteger(mutation.deleteCount) || mutation.deleteCount < 0) {
    throw new Error('invalid_text_patch')
  }
  const end = mutation.start + mutation.deleteCount
  if (end > base.length || isSurrogateBoundary(base, mutation.start) || isSurrogateBoundary(base, end)) {
    throw new Error('invalid_text_patch')
  }
  return base.slice(0, mutation.start) + mutation.insert + base.slice(end)
}

export function assertTextTerminalMutation(value: unknown): TextTerminalMutation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_text_mutation')
  const record = value as Record<string, unknown>
  if (record.kind === 'replace') {
    assertExactKeys(record, ['kind', 'content'])
    if (typeof record.content !== 'string') throw new Error('invalid_text_mutation')
    return { kind: 'replace', content: record.content }
  }
  if (record.kind === 'patch') {
    assertExactKeys(record, ['kind', 'start', 'deleteCount', 'insert'])
    if (!Number.isInteger(record.start) || !Number.isInteger(record.deleteCount) || typeof record.insert !== 'string') {
      throw new Error('invalid_text_mutation')
    }
    return {
      kind: 'patch',
      start: record.start as number,
      deleteCount: record.deleteCount as number,
      insert: record.insert,
    }
  }
  throw new Error('invalid_text_mutation')
}

export function isSha256TextHash(value: unknown): value is string {
  return typeof value === 'string' && /^sha256:[0-9a-f]{64}$/.test(value)
}

function commonPrefixLength(left: string, right: string): number {
  const limit = Math.min(left.length, right.length)
  let index = 0
  while (index < limit && left.charCodeAt(index) === right.charCodeAt(index)) index += 1
  return index
}

function commonSuffixLength(left: string, right: string, prefix: number): number {
  const limit = Math.min(left.length, right.length) - prefix
  let length = 0
  while (length < limit
    && left.charCodeAt(left.length - length - 1) === right.charCodeAt(right.length - length - 1)) length += 1
  return length
}

function isSurrogateBoundary(value: string, index: number): boolean {
  if (index <= 0 || index >= value.length) return false
  const before = value.charCodeAt(index - 1)
  const after = value.charCodeAt(index)
  return before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff
}

function assertExactKeys(record: Record<string, unknown>, keys: string[]): void {
  const unknown = Object.keys(record).find((key) => !keys.includes(key))
  if (unknown || Object.keys(record).length !== keys.length) throw new Error('invalid_text_mutation')
}
