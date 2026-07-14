import { assertGeneratedId } from '../src/lib/generatedId'
import type { TerminalIndexMapItem } from '../src/lib/protocol'

export class RoomTerminalStore {
  readonly terminalOrder: string[] = []

  addTerminal(terminalId: string, atIndex?: number): number {
    const normalizedId = assertGeneratedId(terminalId, 'terminal')
    if (this.terminalOrder.includes(normalizedId)) throw new Error('terminal_id_conflict:' + normalizedId)
    if (atIndex === undefined) this.terminalOrder.push(normalizedId)
    else {
      if (!Number.isInteger(atIndex) || atIndex < 1 || atIndex > this.terminalOrder.length + 1) throw new Error('invalid_terminal_index:' + atIndex)
      this.terminalOrder.splice(atIndex - 1, 0, normalizedId)
    }
    return this.indexOf(normalizedId)
  }

  removeTerminal(terminalId: string): void {
    const index = this.terminalOrder.indexOf(terminalId)
    if (index !== -1) this.terminalOrder.splice(index, 1)
  }

  moveTerminal(terminalId: string, newIndex: number): TerminalIndexMapItem[] {
    if (!Number.isInteger(newIndex) || newIndex < 1 || newIndex > this.terminalOrder.length) {
      throw new Error('invalid_terminal_index:' + newIndex)
    }
    const current = this.terminalOrder.indexOf(terminalId)
    if (current === -1) throw new Error('terminal_not_in_room:' + terminalId)
    this.terminalOrder.splice(current, 1)
    this.terminalOrder.splice(newIndex - 1, 0, terminalId)
    return this.indexMap()
  }

  indexOf(terminalId: string): number {
    const index = this.terminalOrder.indexOf(terminalId)
    if (index === -1) throw new Error('terminal_not_in_room:' + terminalId)
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
    }))
  }
}
