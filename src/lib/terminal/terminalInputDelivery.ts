import { terminalEndingSequence, type TerminalEnding } from './terminalEnding'

export const TERMINAL_INPUT_DELIVERIES = ['auto', 'direct', 'bracketed-paste'] as const
export const RESOLVED_TERMINAL_INPUT_DELIVERIES = ['direct', 'bracketed-paste'] as const

export type TerminalInputDelivery = (typeof TERMINAL_INPUT_DELIVERIES)[number]
export type ResolvedTerminalInputDelivery = (typeof RESOLVED_TERMINAL_INPUT_DELIVERIES)[number]
export type TabCapabilityKind = 'shell' | 'text'

export const BRACKETED_PASTE_BEGIN = '\u001b[200~'
export const BRACKETED_PASTE_END = '\u001b[201~'
export const BRACKETED_PASTE_END_MARKER_IN_CONTENT = 'bracketed_paste_end_marker_in_content' as const

const TERMINAL_INPUT_DELIVERY_SET = new Set<string>(TERMINAL_INPUT_DELIVERIES)
const RESOLVED_TERMINAL_INPUT_DELIVERY_SET = new Set<string>(RESOLVED_TERMINAL_INPUT_DELIVERIES)

export type TerminalInputPayloadResult =
  | { ok: true; payload: string }
  | { ok: false; reason: typeof BRACKETED_PASTE_END_MARKER_IN_CONTENT }

export function isTerminalInputDelivery(value: unknown): value is TerminalInputDelivery {
  return typeof value === 'string' && TERMINAL_INPUT_DELIVERY_SET.has(value)
}

export function isResolvedTerminalInputDelivery(value: unknown): value is ResolvedTerminalInputDelivery {
  return typeof value === 'string' && RESOLVED_TERMINAL_INPUT_DELIVERY_SET.has(value)
}

export function resolveTerminalInputDelivery(delivery: TerminalInputDelivery, targetKind: TabCapabilityKind): ResolvedTerminalInputDelivery {
  if (targetKind !== 'shell' && targetKind !== 'text') throw new Error('unsupported_terminal_input_target_kind:' + String(targetKind))
  if (delivery === 'direct' || delivery === 'bracketed-paste') return delivery
  if (delivery !== 'auto') throw new Error('unsupported_terminal_input_delivery:' + String(delivery))
  return targetKind === 'shell' ? 'bracketed-paste' : 'direct'
}

export function buildTerminalInputPayload(content: string, delivery: ResolvedTerminalInputDelivery, ending: TerminalEnding): TerminalInputPayloadResult {
  if (!isResolvedTerminalInputDelivery(delivery)) throw new Error('unsupported_resolved_terminal_input_delivery:' + String(delivery))
  const suffix = terminalEndingSequence(ending)
  if (delivery === 'direct') return { ok: true, payload: content + suffix }
  if (content.includes(BRACKETED_PASTE_END)) return { ok: false, reason: BRACKETED_PASTE_END_MARKER_IN_CONTENT }
  return { ok: true, payload: BRACKETED_PASTE_BEGIN + content + BRACKETED_PASTE_END + suffix }
}
