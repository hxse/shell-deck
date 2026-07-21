<script lang="ts">
  import type {
    CaptureSourceConfig,
    MessageSpec,
    ParallelCaptureSourceConfig,
    ParallelLaneActionNode,
    TerminalEnding,
    TerminalInputDelivery,
  } from '../../macro/macroDefinitionTypes'
  import type { ArtifactChoice } from '../../macro/macroArtifactChoices'
  import { defaultParallelCaptureSource } from '../../macro/macroEditorDefaults'
  import type { TextTemplateScope } from '../../macro/scopedTextTemplateEditor'
  import type { CapabilityCaptureKind } from '../../macro/macroTerminalChoices'
  import CaptureSourceEditor from './CaptureSourceEditor.svelte'
  import ExtractTextEditor, { type EditableExtractTextNode } from './ExtractTextEditor.svelte'
  import MessagePartsEditor from './MessagePartsEditor.svelte'
  import NodeActionControls from './NodeActionControls.svelte'
  import TerminalEndingField from './TerminalEndingField.svelte'
  import TerminalInputDeliveryField from './TerminalInputDeliveryField.svelte'

  let {
    item,
    itemIndex,
    moveDownDisabled,
    collapsed,
    artifactChoices,
    templateScope,
    allowedCaptureKinds,
    captureAllowed,
    onSetId,
    onToggle,
    onMove,
    onAddBefore,
    onAddAfter,
    onRemove,
    onUpdate,
  } = $props<{
    item: ParallelLaneActionNode
    itemIndex: number
    moveDownDisabled: boolean
    collapsed: boolean
    artifactChoices: ArtifactChoice[]
    templateScope: TextTemplateScope | null
    allowedCaptureKinds: CapabilityCaptureKind[]
    captureAllowed: boolean
    onSetId: (nextId: string) => boolean
    onToggle: () => void
    onMove: (offset: -1 | 1) => void
    onAddBefore: (event: MouseEvent) => void
    onAddAfter: (event: MouseEvent) => void
    onRemove: () => void
    onUpdate: (mutator: (action: ParallelLaneActionNode) => void) => void
  }>()

  function setWaitMode(action: Extract<ParallelLaneActionNode, { type: 'wait' }>, mode: string): void {
    const record = action as unknown as Record<string, unknown>
    delete record.durationMs
    delete record.quietMs
    delete record.maxMs
    delete record.onTimeout
    if (mode === 'duration') Object.assign(record, { mode: 'duration', durationMs: 1500 })
    if (mode === 'terminal-quiet') {
      Object.assign(record, { mode: 'terminal-quiet', quietMs: 1000, maxMs: 600000, onTimeout: 'pause' })
    }
  }

  function setCaptureKind(kind: CaptureSourceConfig['kind']): void {
    onUpdate((action: ParallelLaneActionNode) => {
      if (action.type === 'capture-source') action.capture = defaultParallelCaptureSource(kind)
    })
  }

  function setCapture(capture: ParallelCaptureSourceConfig): void {
    onUpdate((action: ParallelLaneActionNode) => { if (action.type === 'capture-source') action.capture = capture })
  }
</script>

<article class="step-card parallel-lane-action" class:collapsed data-testid="parallel-lane-action" data-parallel-action-id={item.id} data-parallel-action-type={item.type}>
  <div class="step-title node-title-row">
    <div class="node-title-cluster">
      <strong>{itemIndex + 1}. {item.type}</strong>
      {#if collapsed}<span class="collapse-state-badge" data-testid="node-collapsed-badge">Collapsed</span>{/if}
    </div>
    <NodeActionControls collapsed={collapsed} moveUpDisabled={itemIndex === 0} {moveDownDisabled} groupTestId="parallel-node-action-controls" toggleTestId="parallel-node-toggle-collapse" moveUpTestId="parallel-node-move-up" moveDownTestId="parallel-node-move-down" addBeforeTestId="parallel-lane-add-before" addAfterTestId="parallel-lane-add-after" removeTestId="parallel-node-remove" onToggle={onToggle} onMoveUp={() => onMove(-1)} onMoveDown={() => onMove(1)} {onAddBefore} {onAddAfter} onRemove={onRemove} />
  </div>
  <label>Action id<input data-testid="parallel-action-id-input" value={item.id} oninput={(event) => { if (!onSetId(event.currentTarget.value)) event.currentTarget.value = item.id }} /></label>

  {#if item.type === 'send'}
    <MessagePartsEditor message={item.message} onChange={(message: MessageSpec) => onUpdate((action: ParallelLaneActionNode) => { if (action.type === 'send') action.message = message })} choices={artifactChoices} {templateScope} testId="parallel-message-parts-editor" textPartTestId="parallel-message-text-part" />
    <TerminalInputDeliveryField value={item.delivery} onChange={(delivery: TerminalInputDelivery) => onUpdate((action: ParallelLaneActionNode) => { if (action.type === 'send') action.delivery = delivery })} testId="parallel-send-input-delivery" />
    <TerminalEndingField value={item.ending} onChange={(ending: TerminalEnding) => onUpdate((action: ParallelLaneActionNode) => { if (action.type === 'send') action.ending = ending })} testId="parallel-send-ending-sequence" />
  {:else if item.type === 'wait'}
    <label>Mode<select data-testid="parallel-wait-mode" value={item.mode} onchange={(event) => onUpdate((action: ParallelLaneActionNode) => {
      if (action.type !== 'wait') return
      setWaitMode(action, event.currentTarget.value)
    })}><option value="duration">duration</option><option value="terminal-quiet">terminal-quiet</option></select></label>
    {#if item.mode === 'duration'}
      <label>Duration ms<input data-testid="parallel-wait-duration-ms" type="number" value={item.durationMs} oninput={(event) => onUpdate((action: ParallelLaneActionNode) => { if (action.type === 'wait' && action.mode === 'duration') action.durationMs = Number(event.currentTarget.value) })} /></label>
     {:else if item.mode === 'terminal-quiet'}
      <div class="macro-row">
        <label>Quiet ms<input data-testid="parallel-wait-quiet-ms" type="number" value={item.quietMs} oninput={(event) => onUpdate((action: ParallelLaneActionNode) => { if (action.type === 'wait' && action.mode === 'terminal-quiet') action.quietMs = Number(event.currentTarget.value) })} /></label>
        <label>Max ms<input data-testid="parallel-wait-max-ms" type="number" value={item.maxMs} oninput={(event) => onUpdate((action: ParallelLaneActionNode) => { if (action.type === 'wait' && action.mode === 'terminal-quiet') action.maxMs = Number(event.currentTarget.value) })} /></label>
      </div>
    {/if}
  {:else if item.type === 'capture-source'}
    <CaptureSourceEditor
      variant="parallel"
      capture={item.capture}
      allowedKinds={allowedCaptureKinds}
      {captureAllowed}
      onKindChange={setCaptureKind}
      onChange={(capture) => setCapture(capture as ParallelCaptureSourceConfig)}
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
