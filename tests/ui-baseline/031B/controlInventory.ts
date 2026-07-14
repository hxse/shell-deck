export type UiControlEvidenceKind = 'clicked' | 'edited' | 'boundary' | 'excluded'

export type UiControlInventoryEntry = {
  key: string
  evidence: UiControlEvidenceKind
  changedBy?: string
  oldBehavior?: string
  newBehavior?: string
  spec?: string
  reason?: string
}

// Historical .031A truth remains immutable. Every later workspace compares its
// current source surface separately and attributes any runtime-control delta.
export const baseline031ASourceInteractiveControlCount = 202
export const baseline031ASourceInteractiveControlDigest = '7de9ac2946db94a2134e22539477094c04cc95caef6f44afce0738ff388fec19'

export const sourceInteractiveControlCount032 = 18
export const sourceInteractiveControlDigest032 = '08cd10d9663687281cecf5f1b2d761cd55570efafabd57bf0de9972aba8a2b2d'
export const sourceInteractiveControlCount033 = 19
export const sourceInteractiveControlDigest033 = '4ff921d1d3f120d6cffee8b2b842a9edfefcc545dedf2fec0d8080d6185afb3b'

export const sourceInteractiveControlCount034 = 175
export const sourceInteractiveControlDigest034 = 'ab466194c9bed56c5377668fcaf78e14d520a87067bac8f0d65dc413e59c4834'
export const sourceInteractiveControlCount035 = 174
export const sourceInteractiveControlDigest035 = 'c0be373c0b0c28b1ac83084b4d7bda99417c1345a0b303ebbb45283429298584'

// A later task updates only these current-workspace values, never the historical
// constants above. A mismatch must be paired with attributed behavior changes.
export const sourceInteractiveControlCount = 195
export const sourceInteractiveControlDigest = '8002c90a04aa50f4f7a092451b2a3b4c803a64d02c99cc410498f21be148c976'

export const baseline031ARuntimeControlIds = [
  // Workspace, settings, notices, panels, terminals.
  'macro-panel-toggle',
  'prompt-panel-toggle',
  'terminal-create-fake',
  'terminal-create-real',
  'terminal-create-text',
  'settings-button',
  'settings-close',
  'settings-dismiss-layer',
  'macro-insertion-placement-toggle',
  'notification-volume',
  'notification-success-sound-test',
  'tab-drag-toggle',
  'notice-dismiss',
  'notice-dismiss-layer',
  'terminal-tab',
  'terminal-alias-input',
  'terminal-tab-close',
  'text-box-editor',
  'text-box-copy',
  'macro-resize-handle',
  'prompt-resize-handle',

  // Prompt panel.
  'prompt-reset-width',
  'prompt-scope-filter',
  'prompt-search',
  'prompt-selector',
  'prompt-new-project',
  'prompt-new-global',
  'prompt-save',
  'prompt-copy',
  'prompt-delete',
  'prompt-edit-scope',
  'prompt-title',
  'prompt-tags',
  'prompt-body',

  // Macro template chrome and views.
  'macro-template-drawer',
  'macro-template-dismiss-layer',
  'macro-template-search',
  'macro-template-select',
  'macro-create',
  'macro-save',
  'macro-duplicate',
  'macro-import',
  'macro-import-file',
  'macro-export',
  'macro-delete',
  'macro-name',
  'macro-description',
  'macro-reset-width',
  'macro-tab-editor',
  'macro-tab-json',
  'macro-tab-trace',
  'macro-json-copy',
  'macro-edit-json',
  'macro-save-json',
  'macro-cancel-json',
  'macro-export-json',
  'macro-json-editor',
  'macro-validation-toggle',

  // Runner and Trace.
  'macro-control-start',
  'macro-control-pause-resume',
  'macro-control-stop',
  'macro-debug-toggle',
  'macro-run-refresh',
  'macro-run-input-text',
  'macro-run-input-submit',
  'run-create',
  'run-append-demo',
  'run-trace-copy',
  'run-log-debug-toggle',
  'run-log-refresh',
  'run-tab-log',
  'run-tab-ai',
  'run-list-item',
  'run-node-log-toggle',
  'run-artifact-ref',

  // Main insertion and generic node chrome.
  'empty-body-add',
  'add-step-send',
  'add-step-notify',
  'add-step-input',
  'add-step-wait',
  'add-step-capture',
  'add-step-extract',
  'add-step-parallel',
  'add-flow-if',
  'add-flow-for',
  'add-flow-finish',
  'add-flow-break',
  'add-flow-continue',
  'macro-move-existing-select',
  'macro-move-existing',
  'macro-insertion-cancel',
  'macro-insertion-cancel-scrim',
  'node-toggle-collapse',
  'node-move-up',
  'node-move-down',
  'node-add-before',
  'node-add-after',
  'node-remove',
  'node-id-input',
  'flow-control-reason',

  // Message, send, input, wait and notification actions.
  'message-add-text',
  'message-add-source',
  'message-part-up',
  'message-part-down',
  'message-part-remove',
  'message-text-part',
  'message-source-part',
  'message-template-toggle',
  'message-template-insert-index',
  'message-template-insert-key',
  'message-template-insert-value',
  'send-terminal',
  'send-input-delivery-help',
  'send-input-delivery',
  'send-ending-sequence',
  'notify-level',
  'notify-on-failure',
  'notify-title',
  'notify-title-template-toggle',
  'notify-title-template-insert-index',
  'notify-title-template-insert-key',
  'notify-title-template-insert-value',
  'notify-channel-app',
  'notify-channel-system',
  'notify-channel-telegram',
  'notify-app-toast',
  'notify-app-sound',
  'notify-telegram-profile',
  'input-terminal',
  'input-prompt',
  'input-prompt-template-toggle',
  'input-prompt-template-insert-index',
  'input-prompt-template-insert-key',
  'input-prompt-template-insert-value',
  'input-allow-empty',
  'input-input-delivery-help',
  'input-input-delivery',
  'input-ending-sequence',
  'input-default-source',
  'wait-mode',
  'wait-duration-ms',
  'wait-target-tab',
  'wait-quiet-ms',
  'wait-max-ms',
  'wait-on-timeout',
  'wait-user-continue-prompt',
  'wait-user-continue-prompt-template-toggle',
  'wait-user-continue-prompt-template-insert-index',
  'wait-user-continue-prompt-template-insert-key',
  'wait-user-continue-prompt-template-insert-value',

  // Capture and extract.
  'capture-step-terminal',
  'capture-step-kind',
  'capture-terminal-buffer-mode',
  'capture-max-chars',
  'capture-kind-repair',
  'extract-text-source',
  'extract-text-split-kind',
  'extract-text-keep-empty',
  'extract-text-split-pattern',
  'extract-text-split-flags',
  'extract-add-filter',
  'extract-filter-mode',
  'extract-filter-matcher-kind',
  'extract-filter-simple-op',
  'extract-filter-simple-text',
  'extract-filter-regex-pattern',
  'extract-filter-regex-flags',
  'extract-filter-remove',
  'extract-text-select-mode',
  'extract-text-select-index',
  'extract-text-select-start',
  'extract-text-select-end',
  'extract-text-extract-kind',
  'extract-text-trim',
  'extract-text-on-empty',
  'extract-text-regex-pattern',
  'extract-text-regex-flags',
  'extract-text-regex-group',

  // If and for.
  'condition-source',
  'condition-matcher-kind',
  'condition-simple-op',
  'condition-simple-text',
  'condition-regex-pattern',
  'condition-regex-flags',
  'condition-scope',
  'if-branch-toggle',
  'add-flow-elif',
  'add-flow-else',
  'remove-flow-elif',
  'remove-flow-else',
  'for-range-mode',
  'for-range-count',
  'for-text-list-add',
  'for-text-list-item-up',
  'for-text-list-item-down',
  'for-text-list-item-remove',
  'for-text-list-key',
  'for-text-list-value',

  // Parallel.
  'parallel-merge-separator',
  'parallel-include-empty-outputs',
  'parallel-on-lane-fail',
  'parallel-lane-tab',
  'parallel-add-lane',
  'parallel-remove-lane',
  'parallel-lane-id-input',
  'parallel-lane-label-input',
  'parallel-lane-terminal',
  'parallel-lane-insertion-cancel',
  'parallel-lane-insertion-cancel-scrim',
  'parallel-add-send',
  'parallel-add-wait',
  'parallel-add-capture',
  'parallel-add-extract',
  'parallel-node-toggle-collapse',
  'parallel-node-move-up',
  'parallel-node-move-down',
  'parallel-lane-add-before',
  'parallel-lane-add-after',
  'parallel-node-remove',
  'parallel-action-id-input',
  'parallel-message-text-part',
  'parallel-send-input-delivery-help',
  'parallel-send-input-delivery',
  'parallel-send-ending-sequence',
  'parallel-wait-mode',
  'parallel-wait-duration-ms',
  'parallel-wait-quiet-ms',
  'parallel-wait-max-ms',
  'parallel-capture-kind',
  'parallel-capture-mode',
  'parallel-capture-max-chars',
  'parallel-capture-kind-repair',
  'parallel-extract-source',
  'parallel-extract-select-mode',
  'parallel-extract-trim',
  'parallel-extract-on-empty',
  'parallel-lane-add-before-output',
  'parallel-output-id-input',
  'parallel-output-source',
] as const

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

const workspaceRuntimeControls = workspaceRuntimeControls034.filter(([key]) => key !== "home-refresh")

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

const macroRuntimeControls: Array<readonly [string, UiControlEvidenceKind]> = [
  ...baseline031ARuntimeControlIds
    .filter(isCurrent034MacroControl)
    .map((key) => [key, macroEvidenceFor(key)] as const),
  ["macro-edit", "clicked"],
  ["macro-cancel-edit", "clicked"],
  ["macro-prepare-terminals", "clicked"],
  ["macro-insertion-placement", "clicked"],
]

const libraryRuntimeControls: Array<readonly [string, UiControlEvidenceKind]> = [
  ['macro-save-to-library', 'clicked'],
  ['library-panel-toggle', 'clicked'],
  ['library-resize-handle', 'clicked'],
  ['library-reset-width', 'clicked'],
  ['library-tab-macro-template', 'clicked'],
  ['library-tab-prompt', 'clicked'],
  ['library-tab-note', 'clicked'],
  ['library-search', 'edited'],
  ['library-selector', 'edited'],
  ['library-new', 'clicked'],
  ['library-edit', 'clicked'],
  ['library-save', 'clicked'],
  ['library-cancel', 'clicked'],
  ['library-copy', 'clicked'],
  ['library-remove', 'clicked'],
  ['library-refresh', 'clicked'],
  ['library-title', 'edited'],
  ['library-description', 'edited'],
  ['library-tags', 'edited'],
  ['library-content', 'edited'],
  ['library-validate', 'clicked'],
  ['library-load-into-macro', 'clicked'],
]

export const workspaceRuntimeControlInventory034: UiControlInventoryEntry[] = workspaceRuntimeControls034.map(([key, evidence]) => ({ key, evidence }))
export const workspaceRuntimeControlInventory: UiControlInventoryEntry[] = workspaceRuntimeControls.map(([key, evidence]) => ({ key, evidence }))
export const macroRuntimeControlInventory: UiControlInventoryEntry[] = macroRuntimeControls.map(([key, evidence]) => ({ key, evidence }))
export const libraryRuntimeControlInventory: UiControlInventoryEntry[] = libraryRuntimeControls.map(([key, evidence]) => ({ key, evidence }))
export const runtimeControlInventory: UiControlInventoryEntry[] = [...workspaceRuntimeControlInventory, ...macroRuntimeControlInventory, ...libraryRuntimeControlInventory]

const currentRuntimeControls: Array<readonly [string, UiControlEvidenceKind]> = [...workspaceRuntimeControls, ...macroRuntimeControls, ...libraryRuntimeControls]
const currentRuntimeControlIds = new Set<string>(currentRuntimeControls.map(([key]) => key))
const baselineRuntimeControlIds = new Set<string>(baseline031ARuntimeControlIds)

export const attributedControlChanges: UiControlInventoryEntry[] = [
  ...baseline031ARuntimeControlIds
    .filter((key) => !currentRuntimeControlIds.has(key))
    .map((key) => ({
      key,
      evidence: 'boundary' as const,
      changedBy: '20260627A.032',
      oldBehavior: '.031A exposed this control in the production workspace.',
      newBehavior: removedBy032Behavior(key),
      spec: '20260627A.032/02_spec/01_contract.md — Destructive cutover 与 UI preservation 边界',
    })),
  ...currentRuntimeControls
    .filter(([key]) => !baselineRuntimeControlIds.has(key))
    .map(([key, evidence]) => ({
      key,
      evidence,
      changedBy: addedControlTask(key),
      oldBehavior: addedControlOldBehavior(key),
      newBehavior: addedControlNewBehavior(key),
      spec: addedControlSpec(key),
    })),
]
export const attributedRestorations034: UiControlInventoryEntry[] = macroRuntimeControls.map(([key, evidence]) => ({
  key,
  evidence,
  changedBy: "20260627A.034",
  oldBehavior: ".033 intentionally had no production Macro surface while the Room/controller foundation was rebuilt.",
  newBehavior: ".034 restores this control on MacroDefinitionV3 while preserving the .031A presentation and current Room/controller contracts.",
  spec: "20260627A.034/02_spec/01_contract.md — UI preservation, Macro workbench and explicit Prepare/Start",
}))

export const attributedControlChanges035: UiControlInventoryEntry[] = [{
  key: "home-refresh",
  evidence: "boundary",
  changedBy: "20260627A.035",
  oldBehavior: ".034 exposed a manual Home Refresh button.",
  newBehavior: ".035 removes the button; Home refreshes from server state on visibility/focus and a bounded Svelte effect interval.",
  spec: "20260627A.035/02_spec/01_contract.md — Home自动刷新",
}]

export const attributedBehaviorChanges: UiControlInventoryEntry[] = [
  ['terminal-create-real', 'Shell creation becomes controller-only.'],
  ['terminal-create-text', 'Text creation becomes controller-only.'],
  ['terminal-host', 'Shell input becomes controller-only while output remains observable.'],
  ['text-box-editor', 'Text content mutation becomes controller-only while observer content remains readable.'],
  ['terminal-tab', 'Tab selection remains local, while drag reorder becomes controller-only.'],
  ['terminal-tab-close', 'Terminal close becomes controller-only.'],
].map<UiControlInventoryEntry>(([key, newBehavior]) => ({
  key,
  evidence: 'boundary',
  changedBy: '20260627A.033',
  oldBehavior: '.032 allowed every connected Room client to submit this shared mutation.',
  newBehavior,
  spec: '20260627A.033/02_spec/01_contract.md — Server-side mutation guard and UI精准重构边界',
}))

function isCurrent034MacroControl(key: string): boolean {
  if (removedMacroControls034.has(key)) return false
  if (["macro-panel-toggle", "macro-resize-handle", "notification-volume", "notification-success-sound-test"].includes(key)) return true
  return ["macro-", "node-", "add-", "message-", "send-", "notify-", "input-", "wait-", "capture-", "extract-", "condition-", "if-", "for-", "parallel-", "flow-"].some((prefix) => key.startsWith(prefix)) || key === "empty-body-add"
}

function macroEvidenceFor(key: string): UiControlEvidenceKind {
  return /(?:-input|-text|-source|-terminal|-mode|-select|-value|-key|-pattern|-flags|-group|-ms|-title|-description|-name|-reason|-separator|-volume)$/.test(key) ? "edited" : "clicked"
}

function addedControlTask(key: string): string {
  if (key === 'macro-save-to-library') return '20260627A.036'
  if (key.startsWith('library-')) return '20260627A.036'
  if (key === "take-control") return "20260627A.033"
  if (["macro-edit", "macro-cancel-edit", "macro-prepare-terminals", "macro-insertion-placement"].includes(key)) return "20260627A.034"
  return "20260627A.032"
}

function addedControlOldBehavior(key: string): string {
  if (key === 'macro-save-to-library') return '.035 allowed clipboard Copy of Macro JSON but had no explicit Macro-to-Library create action.'
  if (key.startsWith('library-')) return '.035 had no production Library surface; .032 had removed the legacy Prompt schema during the current-schema cutover.'
  if (key === "take-control") return ".032 had no explicit controller handoff control."
  if (addedControlTask(key) === "20260627A.034") return ".031A did not expose this current-schema V3 control with this identity."
  return ".031A had no routed Room/Home control with this identity."
}

function addedControlNewBehavior(key: string): string {
  if (key === 'macro-save-to-library') return '.036 saves the current valid Macro draft as a fresh independent Macro JSON Library item without saving or switching the Macro.'
  if (key.startsWith('library-')) return '.036 restores the side-panel presentation with the current user-global Macro JSON, Prompt and Note Library contract.'
  if (key === "take-control") return ".033 adds explicit confirmed takeover for an observer."
  if (addedControlTask(key) === "20260627A.034") return ".034 adds the explicit V3 edit lifecycle or Prepare control."
  return ".032 adds the canonical Room/Home or current-schema terminal interaction."
}

function addedControlSpec(key: string): string {
  if (key === 'macro-save-to-library') return '20260627A.036/02_spec/01_contract.md — Save current Macro draft to Library'
  if (key.startsWith('library-')) return '20260627A.036/02_spec/01_contract.md — Library UI精准重构边界与Library panel'
  if (key === "take-control") return "20260627A.033/02_spec/01_contract.md — Take Control与丢失控制"
  if (addedControlTask(key) === "20260627A.034") return "20260627A.034/02_spec/01_contract.md — Macro workbench and explicit Prepare"
  return "20260627A.032/02_spec/01_contract.md — canonical Room routes, Home lifecycle and terminal runtime"
}

function removedBy032Behavior(key: string): string {
  if (key === 'terminal-create-fake') return '.032 removes the fake-terminal production control; tests use real Shell and Text only.'
  if (key === 'terminal-alias-input') return '.032 removes terminal alias/rename from the current schema and UI.'
  if (key.startsWith('prompt-')) return '.032 intentionally removes the legacy Prompt panel; the user-content Library is restored by the later Library task.'
  if (
    key.startsWith('macro-') || key.startsWith('node-') || key.startsWith('add-') || key.startsWith('message-')
    || key.startsWith('send-') || key.startsWith('notify-') || key.startsWith('input-') || key.startsWith('wait-')
    || key.startsWith('capture-') || key.startsWith('extract-') || key.startsWith('condition-') || key.startsWith('if-')
    || key.startsWith('for-') || key.startsWith('parallel-') || key.startsWith('flow-') || key.startsWith('run-')
  ) return '.032 intentionally has no production Macro V2 editor/runner surface; .034 must restore the current-schema Macro UI from the .031A presentation reference.'
  return '.032 temporarily omits this dependent workspace control while preserving the surviving Room/terminal interaction surface.'
}

export const codexControlExclusions = [
  {
    key: 'macro.capture.agent-kind',
    evidence: 'excluded',
    reason: 'Codex / agent-event UI is explicitly outside the fully offline .031B baseline.',
  },
  {
    key: 'macro.capture.agent-mode',
    evidence: 'excluded',
    reason: 'Codex / agent-event UI is explicitly outside the fully offline .031B baseline.',
  },
  {
    key: 'parallel.capture.agent-kind',
    evidence: 'excluded',
    reason: 'Codex / agent-event UI is explicitly outside the fully offline .031B baseline.',
  },
  {
    key: 'parallel.capture.agent-mode',
    evidence: 'excluded',
    reason: 'Codex / agent-event UI is explicitly outside the fully offline .031B baseline.',
  },
] satisfies UiControlInventoryEntry[]
