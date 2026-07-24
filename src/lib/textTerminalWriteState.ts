import type { TextTerminalMutation } from './textTerminalMutation'

export type InFlightTextWrite = {
  candidate: string
  mutation: TextTerminalMutation
  resultHash: string
  editGeneration: number
  baseTextRevision: number
}

export type TextTerminalWriteState = {
  terminalId: string
  launchId: string
  localContent: string
  syncedContent: string
  syncedHash: string
  localEditGeneration: number
  observedTextRevision: number
  observedRepairGeneration: number
  inFlight: InFlightTextWrite | null
}

export type TextTerminalTruth = {
  terminalId: string
  launchId: string
  content: string
  contentHash: string
  textRevision: number
  repairGeneration: number
}

export function createTextTerminalWriteState(truth: TextTerminalTruth): TextTerminalWriteState {
  return {
    terminalId: truth.terminalId,
    launchId: truth.launchId,
    localContent: truth.content,
    syncedContent: truth.content,
    syncedHash: truth.contentHash,
    localEditGeneration: 0,
    observedTextRevision: truth.textRevision,
    observedRepairGeneration: truth.repairGeneration,
    inFlight: null,
  }
}

export function editTextTerminal(state: TextTerminalWriteState, content: string): TextTerminalWriteState {
  return { ...state, localContent: content, localEditGeneration: state.localEditGeneration + 1 }
}

export function beginLatestTextWrite(
  state: TextTerminalWriteState,
  input: Pick<InFlightTextWrite, 'candidate' | 'mutation' | 'resultHash' | 'editGeneration'>,
) {
  if (state.inFlight) return null
  const request: InFlightTextWrite = {
    ...input,
    baseTextRevision: state.observedTextRevision,
  }
  return { state: { ...state, inFlight: request }, request }
}

export function observeTextTerminalTruth(state: TextTerminalWriteState, truth: TextTerminalTruth) {
  if (truth.terminalId !== state.terminalId || truth.launchId !== state.launchId) {
    return { state: createTextTerminalWriteState(truth), needsWrite: false }
  }
  if (truth.repairGeneration > state.observedRepairGeneration) {
    const repaired = createTextTerminalWriteState(truth)
    const preserveLocal = state.inFlight !== null || state.localContent !== state.syncedContent
    if (!preserveLocal || state.localContent === truth.content) {
      return { state: repaired, needsWrite: false }
    }
    return {
      state: {
        ...repaired,
        localContent: state.localContent,
        localEditGeneration: state.localEditGeneration,
      },
      needsWrite: true,
    }
  }

  const pending = state.inFlight
  if (pending) {
    if (truth.textRevision <= pending.baseTextRevision) {
      return { state, needsWrite: false }
    }
    if (truth.content !== pending.candidate || truth.contentHash !== pending.resultHash) {
      return rebaseLocalOnTruth(state, truth)
    }
    const acknowledged = {
      ...state,
      syncedContent: truth.content,
      syncedHash: truth.contentHash,
      observedTextRevision: truth.textRevision,
      observedRepairGeneration: truth.repairGeneration,
      inFlight: null,
    }
    if (state.localEditGeneration > pending.editGeneration) return { state: acknowledged, needsWrite: true }
    return { state: { ...acknowledged, localContent: truth.content }, needsWrite: false }
  }

  if (truth.textRevision <= state.observedTextRevision) return { state, needsWrite: false }
  if (state.localContent !== state.syncedContent) return rebaseLocalOnTruth(state, truth)
  return {
    state: {
      ...state,
      localContent: truth.content,
      syncedContent: truth.content,
      syncedHash: truth.contentHash,
      observedTextRevision: truth.textRevision,
      observedRepairGeneration: truth.repairGeneration,
    },
    needsWrite: false,
  }
}

function rebaseLocalOnTruth(state: TextTerminalWriteState, truth: TextTerminalTruth) {
  const authoritative = createTextTerminalWriteState(truth)
  if (state.localContent === truth.content) return { state: authoritative, needsWrite: false }
  return {
    state: {
      ...authoritative,
      localContent: state.localContent,
      localEditGeneration: state.localEditGeneration,
    },
    needsWrite: true,
  }
}
