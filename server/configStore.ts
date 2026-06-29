import { assertValidPublicId } from '../src/lib/identifier'
import type { TerminalIndexMapItem } from '../src/lib/protocol'

export class ConfigStore {
  readonly configId: string
  readonly terminalOrder: string[] = []
  readonly terminalAliases = new Map<string, string>()

  constructor(configId: string) {
    this.configId = assertValidPublicId(configId, 'configId')
  }

  addTerminal(terminalId: string, alias?: string): number {
    if (this.terminalOrder.includes(terminalId)) {
      if (!this.terminalAliases.has(terminalId)) {
        this.terminalAliases.set(terminalId, this.normalizeAvailableAlias(terminalId, alias ?? this.nextAlias()))
      }
      return this.indexOf(terminalId)
    }

    const normalizedAlias = this.normalizeAvailableAlias(terminalId, alias ?? this.nextAlias())
    this.terminalOrder.push(terminalId)
    this.terminalAliases.set(terminalId, normalizedAlias)
    return this.indexOf(terminalId)
  }

  removeTerminal(terminalId: string): void {
    const index = this.terminalOrder.indexOf(terminalId)
    if (index !== -1) {
      this.terminalOrder.splice(index, 1)
    }
    this.terminalAliases.delete(terminalId)
  }

  moveTerminal(terminalId: string, newIndex: number): TerminalIndexMapItem[] {
    if (!Number.isInteger(newIndex) || newIndex < 1 || newIndex > this.terminalOrder.length) {
      throw new Error('invalid_terminalIndex:' + newIndex)
    }
    const current = this.terminalOrder.indexOf(terminalId)
    if (current === -1) {
      throw new Error('terminal_not_in_config:' + terminalId)
    }
    this.terminalOrder.splice(current, 1)
    this.terminalOrder.splice(newIndex - 1, 0, terminalId)
    return this.indexMap()
  }

  renameTerminal(terminalId: string, alias: string): string {
    if (!this.terminalOrder.includes(terminalId)) {
      throw new Error('terminal_not_in_config:' + terminalId)
    }
    const normalized = this.normalizeAvailableAlias(terminalId, alias)
    this.terminalAliases.set(terminalId, normalized)
    return normalized
  }

  aliasOf(terminalId: string): string {
    const alias = this.terminalAliases.get(terminalId)
    if (!alias) {
      throw new Error('terminal_alias_not_found:' + terminalId)
    }
    return alias
  }

  terminalIdByAlias(alias: string): string {
    const normalized = assertValidPublicId(alias, 'terminalAlias')
    for (const [terminalId, terminalAlias] of this.terminalAliases) {
      if (terminalAlias === normalized) return terminalId
    }
    throw new Error('terminal_alias_not_found:' + normalized)
  }

  indexOf(terminalId: string): number {
    const index = this.terminalOrder.indexOf(terminalId)
    if (index === -1) {
      throw new Error('terminal_not_in_config:' + terminalId)
    }
    return index + 1
  }

  terminalIdAt(index: number): string {
    if (!Number.isInteger(index) || index < 1 || index > this.terminalOrder.length) {
      throw new Error('terminal_index_not_found:' + index)
    }
    return this.terminalOrder[index - 1]
  }

  indexMap(): TerminalIndexMapItem[] {
    return this.terminalOrder.map((terminalId, index) => ({
      index: index + 1,
      terminalId,
      terminalAlias: this.aliasOf(terminalId),
    }))
  }

  private normalizeAvailableAlias(terminalId: string, alias: string): string {
    const normalized = assertValidPublicId(alias.trim(), 'terminalAlias')
    for (const [existingTerminalId, existingAlias] of this.terminalAliases) {
      if (existingTerminalId !== terminalId && existingAlias === normalized) {
        throw new Error('terminal_alias_conflict:' + normalized)
      }
    }
    return normalized
  }

  private nextAlias(): string {
    for (let index = 1; index < 1000; index += 1) {
      const candidate = 'terminal_' + index
      if (![...this.terminalAliases.values()].includes(candidate)) {
        return candidate
      }
    }
    throw new Error('terminal_alias_exhausted')
  }
}
