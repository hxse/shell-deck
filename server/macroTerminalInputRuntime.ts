import type { TerminalEnding } from '../src/lib/macro/terminalEnding'
import type { FrozenTerminalBinding } from '../src/lib/macro/runnerTypes'
import type { TerminalInputDelivery } from '../src/lib/macro/terminalInputDelivery'
import { buildTerminalInputPayload, resolveTerminalInputDelivery } from '../src/lib/terminal/terminalInputDelivery'
import type { MacroTerminalWriteRequest } from './parallelSharedTextQueue'
import type { TerminalRoomManager } from './terminalRoomManager'

export type MacroTerminalWriteDispatch = (
  request: MacroTerminalWriteRequest,
) => Promise<void>

export async function sendMacroTerminalInput(input: {
  manager: TerminalRoomManager
  roomId: string
  abortSignal: AbortSignal
  isTerminalized: () => boolean
  binding: FrozenTerminalBinding
  terminalIndex: number
  content: string
  delivery: TerminalInputDelivery
  ending: TerminalEnding
  stepId: string
  appendEvent: (kind: string, data?: Record<string, unknown>) => void
  dispatch?: MacroTerminalWriteDispatch
}): Promise<void> {
  if (input.isTerminalized() || input.abortSignal.aborted) throw new Error('run_stopped')
  const resolved = resolveTerminalInputDelivery(input.delivery, input.binding.type)
  const payload = buildTerminalInputPayload(input.content, resolved, input.ending)
  if (!payload.ok) throw new Error(payload.reason)
  const request: MacroTerminalWriteRequest = {
    stepId: input.stepId,
    terminalIndex: input.terminalIndex,
    write: () => {
      if (input.isTerminalized() || input.abortSignal.aborted) throw new Error('run_stopped')
      const result = input.manager.input(input.roomId, input.binding.terminalId, payload.payload)
      if (!result.ok) throw new Error('frozen_terminal_not_ready')
    },
    record: () => {
      const currentTerminalIndex = input.manager.indexMap(input.roomId)
        .find((item) => item.terminalId === input.binding.terminalId)?.index ?? null
      input.appendEvent('terminal_input_sent', {
        stepId: input.stepId,
        configuredTerminalIndex: input.terminalIndex,
        currentTerminalIndex,
        terminalId: input.binding.terminalId,
        launchId: input.binding.launchId,
        requestedDelivery: input.delivery,
        resolvedDelivery: resolved,
        ending: input.ending,
      })
    },
  }
  if (input.dispatch) await input.dispatch(request)
  else {
    request.write()
    request.record()
  }
}
