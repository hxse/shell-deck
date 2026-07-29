import type { MacroDefinitionV6 } from '../../src/lib/macro/macroDefinitionTypes'
import type { TerminalRuntimePosition } from '../../src/lib/protocol'

export function validDefinition(): MacroDefinitionV6 {
  return {
    schemaVersion: 6,
    name: 'V6 macro',
    description: '',
    terminalLayout: [{ index: 1, type: 'shell' }],
    body: [{
      id: 'loop',
      type: 'for',
      range: { kind: 'text-list', items: [{ key: 'phase', value: 'one' }] },
      body: [{ id: 'send', type: 'send', terminal: { kind: 'terminal_index', index: 1 }, message: { parts: [{ kind: 'template', template: '{{index}} {{key}} {{value}}' }] }, delivery: 'auto', ending: 'cr' }],
    }],
  }
}

export function runtimeTerminal(index: number, type: 'shell' | 'text'): TerminalRuntimePosition {
  return {
    index,
    type,
    terminalId: `term_${index}`,
    launchId: `launch_${index}`,
    readiness: 'ready',
  }
}
