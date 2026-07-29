import type {
  MacroTerminalLayoutItem,
  MacroTerminalReference,
  ParallelLaneActionNode,
  ParallelNode,
  ParallelSharedTextOrder,
  TerminalType,
} from './macroDefinitionTypes'

export type ParallelTerminalAccess = 'append' | 'read'

export type ParallelTerminalUse = {
  laneId: string
  laneIndex: number
  actionId: string
  actionIndex: number
  terminalIndex: number
  access: ParallelTerminalAccess
  referencePath: string
}

export type ParallelTerminalUsage =
  | {
      kind: 'shell'
      terminalIndex: number
      terminalType: 'shell'
      ownerLaneId: string
      uses: ParallelTerminalUse[]
    }
  | {
      kind: 'exclusive_text'
      terminalIndex: number
      terminalType: 'text'
      ownerLaneId: string
      uses: ParallelTerminalUse[]
    }
  | {
      kind: 'shared_text'
      terminalIndex: number
      terminalType: 'text'
      order: ParallelSharedTextOrder
      uses: ParallelTerminalUse[]
      sendPlan: string[]
    }

export type ParallelTerminalConflict =
  | { kind: 'shell_shared'; use: ParallelTerminalUse; ownerLaneId: string }
  | { kind: 'shared_text_non_send'; use: ParallelTerminalUse }

export type ParallelTerminalUsageIndex = {
  usesByTerminalIndex: Map<number, ParallelTerminalUse[]>
  byTerminalIndex: Map<number, ParallelTerminalUsage>
  byActionId: Map<string, ParallelTerminalUsage>
  conflicts: ParallelTerminalConflict[]
  sharedTextPlans: Array<Extract<ParallelTerminalUsage, { kind: 'shared_text' }>>
}

export function buildParallelTerminalUsage(
  parallel: ParallelNode,
  layout: MacroTerminalLayoutItem[] | Map<number, TerminalType>,
): ParallelTerminalUsageIndex {
  const terminalTypes = layout instanceof Map
    ? layout
    : new Map(layout.map((item) => [item.index, item.type]))
  const grouped = new Map<number, ParallelTerminalUse[]>()

  const lanes = Array.isArray(parallel.lanes) ? parallel.lanes : []
  lanes.forEach((lane, laneIndex) => {
    if (!lane || typeof lane !== 'object' || !Array.isArray(lane.body)) return
    const laneId = typeof lane.id === 'string' ? lane.id : `lane_${laneIndex + 1}`
    lane.body.forEach((action, actionIndex) => {
      const terminal = terminalUseForAction(action)
      if (!terminal || terminal.reference.kind !== 'terminal_index') return
      const use: ParallelTerminalUse = {
        laneId,
        laneIndex,
        actionId: typeof action.id === 'string' ? action.id : `action_${laneIndex + 1}_${actionIndex + 1}`,
        actionIndex,
        terminalIndex: terminal.reference.index,
        access: terminal.access,
        referencePath: `lanes[${laneIndex}].body[${actionIndex}].${terminal.path}`,
      }
      const uses = grouped.get(use.terminalIndex) ?? []
      uses.push(use)
      grouped.set(use.terminalIndex, uses)
    })
  })

  const byTerminalIndex = new Map<number, ParallelTerminalUsage>()
  const byActionId = new Map<string, ParallelTerminalUsage>()
  const conflicts: ParallelTerminalConflict[] = []
  const sharedTextPlans: Array<Extract<ParallelTerminalUsage, { kind: 'shared_text' }>> = []

  for (const [terminalIndex, uses] of grouped) {
    const terminalType = terminalTypes.get(terminalIndex)
    if (!terminalType) continue
    const laneIds = uniqueLaneIds(uses)
    let usage: ParallelTerminalUsage
    if (terminalType === 'shell') {
      const ownerLaneId = laneIds[0]!
      usage = { kind: 'shell', terminalIndex, terminalType, ownerLaneId, uses }
      for (const use of uses) {
        if (use.laneId !== ownerLaneId) conflicts.push({ kind: 'shell_shared', use, ownerLaneId })
      }
    } else if (laneIds.length === 1) {
      usage = {
        kind: 'exclusive_text',
        terminalIndex,
        terminalType,
        ownerLaneId: laneIds[0]!,
        uses,
      }
    } else {
      usage = {
        kind: 'shared_text',
        terminalIndex,
        terminalType,
        order: parallel.sharedTextOrder,
        uses,
        sendPlan: uses.filter((use) => use.access === 'append').map((use) => use.actionId),
      }
      sharedTextPlans.push(usage)
      for (const use of uses) {
        if (use.access !== 'append') conflicts.push({ kind: 'shared_text_non_send', use })
      }
    }
    byTerminalIndex.set(terminalIndex, usage)
    for (const use of uses) byActionId.set(use.actionId, usage)
  }

  return {
    usesByTerminalIndex: grouped,
    byTerminalIndex,
    byActionId,
    conflicts,
    sharedTextPlans,
  }
}

export function canParallelActionUseTerminal(
  parallel: ParallelNode,
  layout: MacroTerminalLayoutItem[],
  laneId: string,
  action: ParallelLaneActionNode,
  terminalIndex: number,
  usageIndex = buildParallelTerminalUsage(parallel, layout),
): boolean {
  const terminalType = layout.find((item) => item.index === terminalIndex)?.type
  if (!terminalType) return false
  const candidate = terminalUseForAction(action)
  if (!candidate) return false
  const existing = usageIndex.usesByTerminalIndex.get(terminalIndex)
    ?.filter((use) => use.actionId !== action.id) ?? []
  if (terminalType === 'shell') return existing.every((use) => use.laneId === laneId)
  const otherLanes = existing.filter((use) => use.laneId !== laneId)
  if (otherLanes.length === 0) return true
  if (candidate.access !== 'append') return false
  return otherLanes.every((use) => use.access === 'append')
}

export function parallelActionTerminalReference(
  action: ParallelLaneActionNode,
): MacroTerminalReference | undefined {
  return terminalUseForAction(action)?.reference
}

export function parallelTerminalUsageLabel(usage: ParallelTerminalUsage): string {
  if (usage.kind === 'shell') return `Shell · owned by ${usage.ownerLaneId}`
  if (usage.kind === 'exclusive_text') return 'Exclusive Text'
  return usage.order === 'pane_order'
    ? 'Shared Text · pane order'
    : 'Shared Text · completion order'
}

export function parallelTerminalUsageHelp(usage: ParallelTerminalUsage): string {
  if (usage.kind === 'shell') {
    return `Shell ${usage.terminalIndex} is owned by ${usage.ownerLaneId} and cannot be selected by another pane.`
  }
  if (usage.kind === 'exclusive_text') {
    return `Text ${usage.terminalIndex} is only used by this pane, so Send and Capture run immediately.`
  }
  const order = usage.order === 'pane_order'
    ? 'Send appends follow pane order; a later pane may wait for an earlier pane.'
    : 'Each Send appends as soon as it is triggered.'
  return `Text ${usage.terminalIndex} is shared across panes and only supports Send append. ${order}`
}

function terminalUseForAction(
  action: ParallelLaneActionNode | unknown,
): { reference: MacroTerminalReference; access: ParallelTerminalAccess; path: string } | null {
  if (!action || typeof action !== 'object') return null
  const record = action as Record<string, unknown>
  if (record.type === 'send') {
    const reference = terminalReference(record.terminal)
    return reference ? { reference, access: 'append', path: 'terminal' } : null
  }
  if (record.type === 'wait' && record.mode === 'terminal-quiet') {
    const reference = terminalReference(record.terminal)
    return reference ? { reference, access: 'read', path: 'terminal' } : null
  }
  if (record.type === 'capture-source' && record.capture && typeof record.capture === 'object') {
    const reference = terminalReference((record.capture as Record<string, unknown>).terminal)
    return reference ? { reference, access: 'read', path: 'capture.terminal' } : null
  }
  return null
}

function terminalReference(value: unknown): MacroTerminalReference | null {
  if (!value || typeof value !== 'object') return null
  const reference = value as Record<string, unknown>
  if (reference.kind === 'unassigned') return { kind: 'unassigned' }
  if (reference.kind === 'terminal_index' && typeof reference.index === 'number') {
    return { kind: 'terminal_index', index: reference.index }
  }
  return null
}

function uniqueLaneIds(uses: ParallelTerminalUse[]): string[] {
  return [...new Set(uses.map((use) => use.laneId))]
}
