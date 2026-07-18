import type { CaptureSourceConfig, MacroTerminalReference, TerminalType } from './macroDefinitionTypes'
import type { TerminalRuntimePosition } from '../protocol'

export type CapabilityCaptureKind = CaptureSourceConfig['kind']
export type MacroTerminalCapabilities = {
  kind: TerminalType
  canWaitQuiet: boolean
  captureKinds: CapabilityCaptureKind[]
}
export type TerminalChoice = {
  value: string
  label: string
  title: string
  index: number
  type: TerminalType
  capabilities: MacroTerminalCapabilities
}
export type TerminalSelectState = {
  status: 'selected' | 'unassigned' | 'unconfirmed' | 'empty' | 'missing' | 'incompatible'
  value: string
  title: string
  placeholder?: string
}

export function terminalCapabilities(type: TerminalType): MacroTerminalCapabilities {
  return type === 'shell'
    ? { kind: 'shell', canWaitQuiet: true, captureKinds: ['terminal-buffer', 'agent-event'] }
    : { kind: 'text', canWaitQuiet: false, captureKinds: ['text-box'] }
}

export function terminalChoice(item: Pick<TerminalRuntimePosition, 'index' | 'type'>): TerminalChoice {
  const capabilities = terminalCapabilities(item.type)
  return {
    value: String(item.index),
    label: `${item.index} · ${item.type}`,
    title: `Terminal index: ${item.index}\nType: ${item.type}`,
    index: item.index,
    type: item.type,
    capabilities,
  }
}

export function terminalRuntimeChoices(runtimePositions: TerminalRuntimePosition[] | null): TerminalChoice[] {
  return [...(runtimePositions ?? [])]
    .sort((left, right) => left.index - right.index)
    .map(terminalChoice)
}

export function terminalChoiceForIndex(index: number, choices: TerminalChoice[]): TerminalChoice | undefined {
  return choices.find((choice) => choice.index === index)
}

export function terminalSelectState(
  reference: MacroTerminalReference,
  compatibleChoices: TerminalChoice[],
  allChoices: TerminalChoice[] = compatibleChoices,
  expectedType?: TerminalType,
): TerminalSelectState {
  if (reference.kind === 'unassigned') {
    return { status: 'unassigned', value: 'unassigned', title: 'Unassigned' }
  }
  const selectedIndex = reference.index
  const selected = compatibleChoices.find((choice) => choice.index === selectedIndex)
  if (selected && expectedType === selected.type) {
    return { status: 'selected', value: selected.value, title: selected.title }
  }

  if (allChoices.length === 0) {
    const placeholder = 'No terminals available — create a terminal first'
    return { status: 'empty', value: '', title: placeholder, placeholder }
  }

  const actual = allChoices.find((choice) => choice.index === selectedIndex)
  if (actual && expectedType === undefined) {
    const placeholder = `Choose terminal ${selectedIndex} to confirm this target`
    return { status: 'unconfirmed', value: '', title: placeholder, placeholder }
  }

  if (actual && expectedType !== actual.type) {
    const placeholder = compatibleChoices.length === 0
      ? `Terminal ${selectedIndex} changed type — no compatible terminals available`
      : `Terminal ${selectedIndex} changed type — choose a target`
    return { status: 'incompatible', value: '', title: placeholder, placeholder }
  }

  const placeholder = compatibleChoices.length === 0
    ? `Missing terminal ${selectedIndex} — no compatible terminals available`
    : `Missing terminal ${selectedIndex} — choose another terminal`
  return { status: 'missing', value: '', title: placeholder, placeholder }
}

export function isCaptureKindAllowed(capabilities: MacroTerminalCapabilities, kind: CapabilityCaptureKind): boolean {
  return capabilities.captureKinds.includes(kind)
}
