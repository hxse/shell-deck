const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/

export type IdentifierKind = 'configId' | 'terminalId' | 'terminalAlias' | 'clientId' | 'genericId'

export function isValidPublicId(value: string): boolean {
  return ID_RE.test(value) && value !== '..' && !value.includes('/') && !value.includes('\\')
}

export function assertValidPublicId(value: string, kind: IdentifierKind = 'genericId'): string {
  if (!isValidPublicId(value)) {
    throw new Error('invalid_' + kind + ':' + value)
  }
  return value
}

export function parseConfigId(value: string | null | undefined): string {
  return assertValidPublicId(value || 'local', 'configId')
}
