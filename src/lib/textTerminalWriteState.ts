export type InFlightTextWrite = {
  content: string
  editGeneration: number
  baseTextRevision: number
}

export type TextTerminalWriteState = {
  terminalId: string
  launchId: string
  localContent: string
  localEditGeneration: number
  observedTextRevision: number
  inFlight: InFlightTextWrite | null
}

export type TextTerminalTruth = {
  terminalId: string
  launchId: string
  content: string
  textRevision: number
}

export function createTextTerminalWriteState(truth: TextTerminalTruth): TextTerminalWriteState {
  return {
    terminalId: truth.terminalId,
    launchId: truth.launchId,
    localContent: truth.content,
    localEditGeneration: 0,
    observedTextRevision: truth.textRevision,
    inFlight: null,
  }
}

export function editTextTerminal(state: TextTerminalWriteState, content: string): TextTerminalWriteState {
  return { ...state, localContent: content, localEditGeneration: state.localEditGeneration + 1 }
}

export function beginLatestTextWrite(state: TextTerminalWriteState, baseTextRevision: number) {
  if (state.inFlight) return null
  const request: InFlightTextWrite = {
    content: state.localContent,
    editGeneration: state.localEditGeneration,
    baseTextRevision,
  }
  return { state: { ...state, inFlight: request }, request }
}

export function observeTextTerminalTruth(state: TextTerminalWriteState, truth: TextTerminalTruth) {
  if (truth.terminalId !== state.terminalId || truth.launchId !== state.launchId) {
    return { state: createTextTerminalWriteState(truth), needsWrite: false }
  }

  const pending = state.inFlight
  if (pending) {
    if (truth.textRevision <= pending.baseTextRevision || truth.content !== pending.content) {
      return { state, needsWrite: false }
    }
    const acknowledged = { ...state, observedTextRevision: truth.textRevision, inFlight: null }
    if (state.localEditGeneration > pending.editGeneration) return { state: acknowledged, needsWrite: true }
    return { state: { ...acknowledged, localContent: truth.content }, needsWrite: false }
  }

  if (truth.textRevision < state.observedTextRevision) return { state, needsWrite: false }
  if (truth.textRevision === state.observedTextRevision && truth.content === state.localContent) {
    return { state, needsWrite: false }
  }
  return {
    state: { ...state, localContent: truth.content, observedTextRevision: truth.textRevision },
    needsWrite: false,
  }
}
