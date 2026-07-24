import {
  baseline031ARuntimeControlIds,
  type UiControlEvidenceKind,
  type UiControlInventoryEntry,
} from './controlInventoryHistorical'

export const sourceInteractiveControlCount = 183

export const sourceInteractiveControlDigest = '8bc48bddc270d85049ca8f5b1f7329d93b7b3a4b3787869f04fafe6dd11417df'

const workspaceRuntimeControls034 = [
  ["home-refresh", "clicked"],
  ["new-room", "clicked"],
  ["new-room-empty", "clicked"],
  ["room-open", "clicked"],
  ["room-destroy", "clicked"],
  ["home-button", "clicked"],
  ["take-control", "clicked"],
  ["terminal-create-real", "clicked"],
  ["terminal-create-text", "clicked"],
  ["settings-button", "clicked"],
  ["settings-close", "clicked"],
  ["settings-dismiss-layer", "clicked"],
  ["tab-drag-toggle", "clicked"],
  ["notice-dismiss", "clicked"],
  ["notice-dismiss-layer", "clicked"],
  ["terminal-tab", "clicked"],
  ["terminal-tab-close", "clicked"],
  ["terminal-host", "edited"],
  ["text-box-editor", "edited"],
  ["text-box-copy", "clicked"],
] as const satisfies ReadonlyArray<readonly [string, UiControlEvidenceKind]>

const workspaceRuntimeControls = workspaceRuntimeControls034.reduce<Array<readonly [string, UiControlEvidenceKind]>>((controls, [key, evidence]) => {
  if (key === 'home-refresh') return controls
  if (key === 'tab-drag-toggle') controls.push(['theme-select', 'edited'])
  controls.push([key, evidence])
  return controls
}, [])

const removedMacroControls034 = new Set([
  "macro-insertion-placement-toggle",
  "macro-duplicate",
  "macro-import",
  "macro-import-file",
  "macro-export",
  "macro-export-json",
  "capture-agent-kind",
  "capture-agent-mode",
])

export const macroRuntimeControls034: Array<readonly [string, UiControlEvidenceKind]> = [
  ...baseline031ARuntimeControlIds
    .filter(isCurrent034MacroControl)
    .map((key) => [key, macroEvidenceFor(key)] as const),
  ["macro-edit", "clicked"],
  ["macro-cancel-edit", "clicked"],
  ["macro-prepare-terminals", "clicked"],
  ["macro-insertion-placement", "clicked"],
]

const macroControlsAdded001: Array<readonly [string, UiControlEvidenceKind]> = [
  ['for-text-list-item-insert-above', 'clicked'],
  ['for-text-list-item-insert-below', 'clicked'],
  ['notify-app-repeat-count', 'edited'],
  ['notify-app-repeat-interval-ms', 'edited'],
  ['parallel-collect-lane-text', 'clicked'],
]

export const macroControlIdsAdded001 = new Set(macroControlsAdded001.map(([key]) => key))

const macroRuntimeControls: Array<readonly [string, UiControlEvidenceKind]> = [
  ...macroRuntimeControls034.filter(([key]) => key !== 'for-text-list-add'),
  ...macroControlsAdded001,
]

export const workspaceRuntimeControlInventory034: UiControlInventoryEntry[] = workspaceRuntimeControls034.map(([key, evidence]) => ({ key, evidence }))

export const workspaceRuntimeControlInventory: UiControlInventoryEntry[] = workspaceRuntimeControls.map(([key, evidence]) => ({ key, evidence }))

export const macroRuntimeControlInventory034: UiControlInventoryEntry[] = macroRuntimeControls034.map(([key, evidence]) => ({ key, evidence }))

export const macroRuntimeControlInventory: UiControlInventoryEntry[] = macroRuntimeControls.map(([key, evidence]) => ({ key, evidence }))

export const runtimeControlInventory: UiControlInventoryEntry[] = [...workspaceRuntimeControlInventory, ...macroRuntimeControlInventory]

export const currentRuntimeControls: Array<readonly [string, UiControlEvidenceKind]> = [...workspaceRuntimeControls, ...macroRuntimeControls]

export const currentRuntimeControlIds = new Set<string>(currentRuntimeControls.map(([key]) => key))

export const baselineRuntimeControlIds = new Set<string>(baseline031ARuntimeControlIds)

function isCurrent034MacroControl(key: string): boolean {
  if (removedMacroControls034.has(key)) return false
  if (["macro-panel-toggle", "macro-resize-handle", "notification-volume", "notification-success-sound-test"].includes(key)) return true
  return ["macro-", "node-", "add-", "message-", "send-", "notify-", "input-", "wait-", "capture-", "extract-", "condition-", "if-", "for-", "parallel-", "flow-"].some((prefix) => key.startsWith(prefix)) || key === "empty-body-add"
}

function macroEvidenceFor(key: string): UiControlEvidenceKind {
  return /(?:-input|-text|-source|-terminal|-mode|-select|-value|-key|-pattern|-flags|-group|-ms|-title|-description|-name|-reason|-separator|-volume)$/.test(key) ? "edited" : "clicked"
}
