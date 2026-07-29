<script lang="ts">
  import type {
    CaptureSourceConfig,
    MacroTerminalReference,
    ParallelLaneActionNode,
    TerminalEnding,
    TerminalInputDelivery,
  } from '../../macro/macroDefinitionTypes'
  import type { ArtifactChoice } from '../../macro/macroArtifactChoices'
  import { defaultCaptureSource } from '../../macro/macroEditorDefaults'
  import type { ParallelTerminalUsage } from '../../macro/parallelTerminalUsage'
  import type { TextTemplateScope } from '../../macro/scopedTextTemplateEditor'
  import type { CapabilityCaptureKind, TerminalChoice } from '../../macro/macroTerminalChoices'
  import CaptureSourceEditor from './CaptureSourceEditor.svelte'
  import ExtractTextEditor, { type EditableExtractTextNode } from './ExtractTextEditor.svelte'
  import MacroTerminalSelect from './MacroTerminalSelect.svelte'
  import MessagePartsEditor from './MessagePartsEditor.svelte'
  import NodeActionControls from './NodeActionControls.svelte'
  import NotifyActionFields from './NotifyActionFields.svelte'
  import ParallelTerminalUsageBadge from './ParallelTerminalUsageBadge.svelte'
  import TerminalEndingField from './TerminalEndingField.svelte'
  import TerminalInputDeliveryField from './TerminalInputDeliveryField.svelte'

  let {
    item,
    itemIndex,
    moveDownDisabled,
    collapsed,
    artifactChoices,
    templateScope,
    terminalChoices,
    allTerminalChoices,
    disabledTerminalValues,
    expectedTerminalType,
    terminalUsage,
    allowedCaptureKinds,
    captureAllowed,
    telegramProfileIds = [],
    telegramProfilesError = '',
    isCurrent = false,
    onSetId,
    onToggle,
    onMove,
    onAddBefore,
    onAddAfter,
    onRemove,
    onUpdate,
    onTerminalChange,
  } = $props<{
    item: ParallelLaneActionNode
    itemIndex: number
    moveDownDisabled: boolean
    collapsed: boolean
    artifactChoices: ArtifactChoice[]
    templateScope: TextTemplateScope | null
    terminalChoices: TerminalChoice[]
    allTerminalChoices: TerminalChoice[]
    disabledTerminalValues: string[]
    expectedTerminalType?: 'shell' | 'text'
    terminalUsage?: ParallelTerminalUsage
    allowedCaptureKinds: CapabilityCaptureKind[]
    captureAllowed: boolean
    telegramProfileIds?: string[]
    telegramProfilesError?: string
    isCurrent?: boolean
    onSetId: (nextId: string) => boolean
    onToggle: () => void
    onMove: (offset: -1 | 1) => void
    onAddBefore: (event: MouseEvent) => void
    onAddAfter: (event: MouseEvent) => void
    onRemove: () => void
    onUpdate: (mutator: (action: ParallelLaneActionNode) => void) => void
    onTerminalChange: (terminal: MacroTerminalReference) => boolean
  }>()

  function setWaitMode(action: Extract<ParallelLaneActionNode, { type: 'wait' }>, mode: string): void {
    const record = action as unknown as Record<string, unknown>
    delete record.durationMs
    delete record.terminal
    delete record.quietMs
    delete record.maxMs
    delete record.onTimeout
    if (mode === 'duration') Object.assign(record, { mode: 'duration', durationMs: 1500 })
    if (mode === 'terminal-quiet') {
      Object.assign(record, {
        mode: 'terminal-quiet',
        terminal: { kind: 'unassigned' },
        quietMs: 1000,
        maxMs: 600000,
        onTimeout: 'pause',
      })
    }
  }

  function setCaptureKind(kind: CaptureSourceConfig['kind']): void {
    if (kind === 'structured-json') return
    onUpdate((action: ParallelLaneActionNode) => {
      if (action.type !== 'capture-source') return
      const capture = defaultCaptureSource(kind, action.capture.terminal)
      if (capture.kind !== 'structured-json') action.capture = capture
    })
  }

  function setCapture(capture: CaptureSourceConfig): void {
    if (capture.kind === 'structured-json') return
    onUpdate((action: ParallelLaneActionNode) => { if (action.type === 'capture-source') action.capture = capture })
  }
</script>

<article class="step-card parallel-lane-action card grid min-w-0 gap-2 bg-base-200/60 p-2 shadow-sm [&.collapsed>:not(.step-title)]:hidden [&.current-node]:bg-primary/15" class:collapsed class:current-node={isCurrent} data-testid="parallel-lane-action" data-parallel-action-id={item.id} data-parallel-action-type={item.type} data-current-node={isCurrent ? 'true' : undefined}>
  <div class="step-title node-title-row flex min-w-0 flex-wrap items-center justify-between gap-2">
    <div class="node-title-cluster flex min-w-0 flex-wrap items-center gap-1.5">
      <strong>{itemIndex + 1}. {item.type}</strong>
      <ParallelTerminalUsageBadge usage={terminalUsage} />
      {#if collapsed}<span class="collapse-state-badge badge badge-ghost badge-sm text-[10px]" data-testid="node-collapsed-badge">Collapsed</span>{/if}
    </div>
    <NodeActionControls collapsed={collapsed} moveUpDisabled={itemIndex === 0} {moveDownDisabled} groupTestId="parallel-node-action-controls" toggleTestId="parallel-node-toggle-collapse" moveUpTestId="parallel-node-move-up" moveDownTestId="parallel-node-move-down" addBeforeTestId="parallel-lane-add-before" addAfterTestId="parallel-lane-add-after" removeTestId="parallel-node-remove" onToggle={onToggle} onMoveUp={() => onMove(-1)} onMoveDown={() => onMove(1)} {onAddBefore} {onAddAfter} onRemove={onRemove} />
  </div>
  <label>Action id<input class="input box-border input-xs input-ghost w-full bg-base-content/15" data-testid="parallel-action-id-input" value={item.id} oninput={(event) => { if (!onSetId(event.currentTarget.value)) event.currentTarget.value = item.id }} /></label>

  {#if item.type === 'send'}
    <label>Target tab<MacroTerminalSelect testId="parallel-send-terminal" reference={item.terminal} expectedType={expectedTerminalType} choices={terminalChoices} allChoices={allTerminalChoices} disabledValues={disabledTerminalValues} onChange={onTerminalChange} /></label>
    <MessagePartsEditor message={item.message} onUpdate={(mutator) => onUpdate((action: ParallelLaneActionNode) => { if (action.type === 'send') mutator(action.message) })} choices={artifactChoices} {templateScope} testId="parallel-message-parts-editor" textPartTestId="parallel-message-text-part" />
    <TerminalInputDeliveryField value={item.delivery} onChange={(delivery: TerminalInputDelivery) => onUpdate((action: ParallelLaneActionNode) => { if (action.type === 'send') action.delivery = delivery })} testId="parallel-send-input-delivery" />
    <TerminalEndingField value={item.ending} onChange={(ending: TerminalEnding) => onUpdate((action: ParallelLaneActionNode) => { if (action.type === 'send') action.ending = ending })} testId="parallel-send-ending-sequence" />
  {:else if item.type === 'wait'}
    <label>Mode<select class="select box-border select-xs select-ghost w-full bg-base-content/15" data-testid="parallel-wait-mode" value={item.mode} onchange={(event) => onUpdate((action: ParallelLaneActionNode) => { if (action.type === 'wait') setWaitMode(action, event.currentTarget.value) })}><option value="duration">duration</option><option value="terminal-quiet">terminal-quiet</option></select></label>
    {#if item.mode === 'duration'}
      <label>Duration ms<input class="input box-border input-xs input-ghost w-full bg-base-content/15" data-testid="parallel-wait-duration-ms" type="number" value={item.durationMs} oninput={(event) => onUpdate((action: ParallelLaneActionNode) => { if (action.type === 'wait' && action.mode === 'duration') action.durationMs = Number(event.currentTarget.value) })} /></label>
    {:else}
      <label>Target tab<MacroTerminalSelect testId="parallel-wait-terminal" reference={item.terminal} expectedType={expectedTerminalType} choices={terminalChoices} allChoices={allTerminalChoices} disabledValues={disabledTerminalValues} onChange={onTerminalChange} /></label>
      <div class="macro-row">
        <label>Quiet ms<input class="input box-border input-xs input-ghost w-full bg-base-content/15" data-testid="parallel-wait-quiet-ms" type="number" value={item.quietMs} oninput={(event) => onUpdate((action: ParallelLaneActionNode) => { if (action.type === 'wait' && action.mode === 'terminal-quiet') action.quietMs = Number(event.currentTarget.value) })} /></label>
        <label>Max ms<input class="input box-border input-xs input-ghost w-full bg-base-content/15" data-testid="parallel-wait-max-ms" type="number" value={item.maxMs} oninput={(event) => onUpdate((action: ParallelLaneActionNode) => { if (action.type === 'wait' && action.mode === 'terminal-quiet') action.maxMs = Number(event.currentTarget.value) })} /></label>
        <label>On timeout<select class="select box-border select-xs select-ghost w-full bg-base-content/15" data-testid="parallel-wait-on-timeout" value={item.onTimeout} onchange={(event) => onUpdate((action: ParallelLaneActionNode) => { if (action.type === 'wait' && action.mode === 'terminal-quiet') action.onTimeout = event.currentTarget.value as 'pause' | 'finish' })}><option value="pause">pause</option><option value="finish">finish</option></select></label>
      </div>
    {/if}
  {:else if item.type === 'capture-source'}
    <CaptureSourceEditor
      variant="parallel"
      capture={item.capture}
      allowedKinds={allowedCaptureKinds}
      {captureAllowed}
      terminalChoices={() => terminalChoices}
      {allTerminalChoices}
      {disabledTerminalValues}
      {expectedTerminalType}
      onTerminalChange={onTerminalChange}
      onKindChange={setCaptureKind}
      onChange={setCapture}
    />
  {:else if item.type === 'notify'}
    <NotifyActionFields
      node={item}
      {artifactChoices}
      {templateScope}
      {telegramProfileIds}
      {telegramProfilesError}
      onUpdate={(mutator) => onUpdate((action: ParallelLaneActionNode) => { if (action.type === 'notify') mutator(action) })}
    />
  {:else}
    <ExtractTextEditor
      variant="parallel"
      node={item}
      choices={artifactChoices}
      onUpdate={(mutator) => onUpdate((action: ParallelLaneActionNode) => { if (action.type === 'extract_text') mutator(action as EditableExtractTextNode) })}
    />
  {/if}
</article>
