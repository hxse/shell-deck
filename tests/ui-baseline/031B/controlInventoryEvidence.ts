import {
  baseline031ARuntimeControlIds,
  type UiControlInventoryEntry,
} from './controlInventoryHistorical'
import {
  baselineRuntimeControlIds,
  currentRuntimeControlIds,
  currentRuntimeControls,
  macroControlIdsAdded001,
  macroRuntimeControls034,
} from './controlInventoryCurrent'

export const attributedControlChanges: UiControlInventoryEntry[] = [
  ...baseline031ARuntimeControlIds
    .filter((key) => !currentRuntimeControlIds.has(key))
    .map((key) => ({
      key,
      evidence: 'boundary' as const,
      changedBy: removedControlTask(key),
      oldBehavior: '.031A exposed this control in the production workspace.',
      newBehavior: removedControlBehavior(key),
      spec: removedControlSpec(key),
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

export const attributedRestorations034: UiControlInventoryEntry[] = macroRuntimeControls034.map(([key, evidence]) => ({
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

function addedControlTask(key: string): string {
  if (key === 'theme-select') return '20260722B.001'
  if (macroControlIdsAdded001.has(key)) return '20260722A.001'
  if (key === 'macro-save-to-library') return '20260627A.036'
  if (key.startsWith('library-')) return '20260627A.036'
  if (key === "take-control") return "20260627A.033"
  if (["macro-edit", "macro-cancel-edit", "macro-prepare-terminals", "macro-insertion-placement"].includes(key)) return "20260627A.034"
  return "20260627A.032"
}

function addedControlOldBehavior(key: string): string {
  if (key === 'theme-select') return '20260722A.001 had no browser-local UI theme preference control.'
  if (macroControlIdsAdded001.has(key)) return '.010 did not expose this Macro authoring or notification control.'
  if (key === 'macro-save-to-library') return '.035 allowed clipboard Copy of Macro JSON but had no explicit Macro-to-Library create action.'
  if (key.startsWith('library-')) return '.035 had no production Library surface; .032 had removed the legacy Prompt schema during the current-schema cutover.'
  if (key === "take-control") return ".032 had no explicit controller handoff control."
  if (addedControlTask(key) === "20260627A.034") return ".031A did not expose this current-schema V3 control with this identity."
  return ".031A had no routed Room/Home control with this identity."
}

function addedControlNewBehavior(key: string): string {
  if (key === 'theme-select') return '.001 adds the only Theme selector with system plus all 35 registered daisyUI themes.'
  if (macroControlIdsAdded001.has(key)) return '.001 exposes per-item insertion, App notification repetition, or optional Parallel lane text collection through an explicit control.'
  if (key === 'macro-save-to-library') return '.036 saves the current valid Macro draft as a fresh independent Macro JSON Library item without saving or switching the Macro.'
  if (key.startsWith('library-')) return '.036 restores the side-panel presentation with the current user-global Macro JSON, Prompt and Note Library contract.'
  if (key === "take-control") return ".033 adds explicit confirmed takeover for an observer."
  if (addedControlTask(key) === "20260627A.034") return ".034 adds the explicit V3 edit lifecycle or Prepare control."
  return ".032 adds the canonical Room/Home or current-schema terminal interaction."
}

function addedControlSpec(key: string): string {
  if (key === 'theme-select') return '20260722B.001/02_spec/01_contract.md — Settings control'
  if (macroControlIdsAdded001.has(key)) return '20260722A.001/02_spec/01_contract.md — Macro authoring and notification interaction contract'
  if (key === 'macro-save-to-library') return '20260627A.036/02_spec/01_contract.md — Save current Macro draft to Library'
  if (key.startsWith('library-')) return '20260627A.036/02_spec/01_contract.md — Library UI精准重构边界与Library panel'
  if (key === "take-control") return "20260627A.033/02_spec/01_contract.md — Take Control与丢失控制"
  if (addedControlTask(key) === "20260627A.034") return "20260627A.034/02_spec/01_contract.md — Macro workbench and explicit Prepare"
  return "20260627A.032/02_spec/01_contract.md — canonical Room routes, Home lifecycle and terminal runtime"
}

function removedControlTask(key: string): string {
  return key === 'for-text-list-add' ? '20260722A.001' : '20260627A.032'
}

function removedControlBehavior(key: string): string {
  if (key === 'for-text-list-add') return '.001 replaces the header-only append control with per-item insert-above and insert-below controls.'
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

function removedControlSpec(key: string): string {
  if (key === 'for-text-list-add') return '20260722A.001/02_spec/01_contract.md — Text-list local insertion'
  return '20260627A.032/02_spec/01_contract.md — Destructive cutover 与 UI preservation 边界'
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
  {
    key: 'capture-agent-timeout-enabled',
    evidence: 'excluded',
    changedBy: '20260627A.038',
    oldBehavior: '.037 had no explicit AgentEvent wait-limit control.',
    newBehavior: '.038 defaults to unbounded and exposes an explicit timeout checkbox.',
    spec: '20260627A.038/02_spec/01_contract.md — Visual editor and explicit AgentEvent wait limit',
    reason: 'AgentEvent controls are covered by the isolated .038 UI journey, not the non-Codex .031B journey.',
  },
  {
    key: 'capture-agent-timeout-ms',
    evidence: 'excluded',
    changedBy: '20260627A.038',
    oldBehavior: '.037 exposed only the hidden fixed server timeout.',
    newBehavior: '.038 writes an exact timeout duration only when the checkbox is enabled.',
    spec: '20260627A.038/02_spec/01_contract.md — Visual editor and explicit AgentEvent wait limit',
    reason: 'AgentEvent controls are covered by the isolated .038 UI journey, not the non-Codex .031B journey.',
  },
  {
    key: 'parallel-capture-agent-timeout-enabled',
    evidence: 'excluded',
    changedBy: '20260627A.038',
    oldBehavior: '.037 had no explicit Parallel AgentEvent wait-limit control.',
    newBehavior: '.038 defaults Parallel AgentEvent Capture to unbounded and exposes an explicit timeout checkbox.',
    spec: '20260627A.038/02_spec/01_contract.md — Visual editor and explicit AgentEvent wait limit',
    reason: 'AgentEvent controls are covered by the isolated .038 UI journey, not the non-Codex .031B journey.',
  },
  {
    key: 'parallel-capture-agent-timeout-ms',
    evidence: 'excluded',
    changedBy: '20260627A.038',
    oldBehavior: '.037 exposed only the hidden fixed server timeout for Parallel AgentEvent Capture.',
    newBehavior: '.038 writes an exact Parallel timeout duration only when the checkbox is enabled.',
    spec: '20260627A.038/02_spec/01_contract.md — Visual editor and explicit AgentEvent wait limit',
    reason: 'AgentEvent controls are covered by the isolated .038 UI journey, not the non-Codex .031B journey.',
  },
] satisfies UiControlInventoryEntry[]
