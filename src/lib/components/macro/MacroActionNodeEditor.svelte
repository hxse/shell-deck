<script lang="ts">
  import type {
    CaptureSourceConfig,
    FlowV2ActionNode,
    FlowV2Node,
    MacroTerminalReference,
    MessageSpec,
    NotificationLevel,
    NotifyChannel,
    ParallelNode,
    TerminalEnding,
    TerminalInputDelivery,
    WaitNode,
  } from '../../macro/macroDefinitionTypes'
  import {
    artifactSourceKey,
    assignedArtifactSourceFromKey,
    type ArtifactChoice,
  } from '../../macro/macroArtifactChoices'
  import { defaultCaptureSource, defaultNotifyChannel } from '../../macro/macroEditorDefaults'
  import type { TextTemplateScope } from '../../macro/scopedTextTemplateEditor'
  import {
    isCaptureKindAllowed,
    terminalChoiceForIndex,
    type CapabilityCaptureKind,
    type TerminalChoice,
  } from '../../macro/macroTerminalChoices'
  import CaptureSourceEditor from './CaptureSourceEditor.svelte'
  import ExtractTextEditor, { type EditableExtractTextNode } from './ExtractTextEditor.svelte'
  import MacroTerminalSelect from './MacroTerminalSelect.svelte'
  import MessagePartsEditor from './MessagePartsEditor.svelte'
  import TemplatableScalarField from './TemplatableScalarField.svelte'
  import TerminalEndingField from './TerminalEndingField.svelte'
  import TerminalInputDeliveryField from './TerminalInputDeliveryField.svelte'

  type EditableActionNode = Exclude<FlowV2ActionNode, ParallelNode>

  let {
    node,
    artifactChoices,
    templateScope,
    terminalChoices,
    expectedTerminalTypeAt,
    onUpdate,
    onUpdateTerminal,
    telegramProfileIds = [],
    telegramProfilesError = '',
  } = $props<{
    node: EditableActionNode
    artifactChoices: ArtifactChoice[]
    templateScope: TextTemplateScope | null
    terminalChoices: () => TerminalChoice[]
    expectedTerminalTypeAt: (reference: MacroTerminalReference) => 'shell' | 'text' | undefined
    onUpdate: (mutator: (item: FlowV2Node) => void) => void
    onUpdateTerminal: (terminal: MacroTerminalReference, mutator: (item: FlowV2Node) => void) => boolean
    telegramProfileIds?: string[]
    telegramProfilesError?: string
  }>()

  function quietTerminalChoices(): TerminalChoice[] {
    return terminalChoices().filter((choice: TerminalChoice) => choice.capabilities.canWaitQuiet)
  }

  function captureKindsForReference(reference: MacroTerminalReference): CapabilityCaptureKind[] {
    if (reference.kind !== 'terminal_index') return ['terminal-buffer', 'agent-event', 'text-box']
    return terminalChoiceForIndex(reference.index, terminalChoices())?.capabilities.captureKinds
      ?? ['terminal-buffer', 'agent-event', 'text-box']
  }

  function captureAllowed(capture: CaptureSourceConfig): boolean {
    if (capture.terminal.kind !== 'terminal_index') return true
    const choice = terminalChoiceForIndex(capture.terminal.index, terminalChoices())
    return choice ? isCaptureKindAllowed(choice.capabilities, capture.kind) : true
  }

  function setCaptureKind(kind: CaptureSourceConfig['kind']): void {
    if (node.type !== 'capture-source') return
    onUpdate((item: FlowV2Node) => {
      if (item.type === 'capture-source') item.capture = defaultCaptureSource(kind, node.capture.terminal)
    })
  }

  function setCapture(capture: CaptureSourceConfig): void {
    onUpdate((item: FlowV2Node) => { if (item.type === 'capture-source') item.capture = capture })
  }

  function setCaptureTerminal(terminal: MacroTerminalReference): boolean {
    if (node.type !== 'capture-source') return false
    const allowed = captureKindsForReference(terminal)
    const kind = allowed.includes(node.capture.kind) ? node.capture.kind : allowed[0] ?? 'terminal-buffer'
    const capture = defaultCaptureSource(kind, terminal)
    return onUpdateTerminal(terminal, (item: FlowV2Node) => { if (item.type === 'capture-source') item.capture = capture })
  }

  function notifyChannel(kind: NotifyChannel['kind']): NotifyChannel | undefined {
    return node.type === 'notify' ? node.channels.find((channel: NotifyChannel) => channel.kind === kind) : undefined
  }

  function setNotifyChannelEnabled(kind: NotifyChannel['kind'], enabled: boolean): void {
    onUpdate((item: FlowV2Node) => {
      if (item.type !== 'notify') return
      const exists = item.channels.some((channel) => channel.kind === kind)
      if (enabled && !exists) item.channels.push(defaultNotifyChannel(kind))
      if (!enabled) item.channels = item.channels.filter((channel) => channel.kind !== kind)
    })
  }

  function updateNotifyChannel(kind: NotifyChannel['kind'], mutator: (channel: NotifyChannel) => void): void {
    onUpdate((item: FlowV2Node) => {
      if (item.type !== 'notify') return
      let channel = item.channels.find((candidate) => candidate.kind === kind)
      if (!channel) {
        channel = defaultNotifyChannel(kind)
        item.channels.push(channel)
      }
      mutator(channel)
    })
  }

  function telegramProfileChoices(currentProfileId: string): string[] {
    const choices = [...telegramProfileIds]
    if (currentProfileId && !choices.includes(currentProfileId)) choices.unshift(currentProfileId)
    return choices
  }

  function setWaitMode(item: WaitNode, mode: string, terminal: MacroTerminalReference | null = null): void {
    const record = item as unknown as Record<string, unknown>
    delete record.durationMs
    delete record.terminal
    delete record.quietMs
    delete record.maxMs
    delete record.onTimeout
    delete record.prompt
    if (mode === 'duration') Object.assign(record, { mode: 'duration', durationMs: 1500 })
    if (mode === 'terminal-quiet' && terminal) {
      Object.assign(record, { mode: 'terminal-quiet', terminal, quietMs: 1000, maxMs: 600000, onTimeout: 'pause' })
    }
    if (mode === 'user-continue') Object.assign(record, { mode: 'user-continue', prompt: 'Continue when ready' })
  }

  function setNodeWaitMode(mode: string): boolean {
    if (node.type !== 'wait') return false
    if (mode === 'terminal-quiet') {
      const terminal: MacroTerminalReference = { kind: 'unassigned' }
      return onUpdateTerminal(terminal, (item: FlowV2Node) => { if (item.type === 'wait') setWaitMode(item, mode, terminal) })
    }
    onUpdate((item: FlowV2Node) => { if (item.type === 'wait') setWaitMode(item, mode) })
    return true
  }
</script>

{#if node.type === 'send'}
  <label>Target tab
    <MacroTerminalSelect testId="send-terminal" reference={node.terminal} expectedType={expectedTerminalTypeAt(node.terminal)} choices={terminalChoices()} onChange={(terminal) => onUpdateTerminal(terminal, (item: FlowV2Node) => { if (item.type === 'send') item.terminal = terminal })} />
  </label>
  <MessagePartsEditor message={node.message} onChange={(message: MessageSpec) => onUpdate((item: FlowV2Node) => { if (item.type === 'send') item.message = message })} choices={artifactChoices} {templateScope} />
  <TerminalInputDeliveryField value={node.delivery} onChange={(delivery: TerminalInputDelivery) => onUpdate((item: FlowV2Node) => { if (item.type === 'send') item.delivery = delivery })} testId="send-input-delivery" />
  <TerminalEndingField value={node.ending} onChange={(ending: TerminalEnding) => onUpdate((item: FlowV2Node) => { if (item.type === 'send') item.ending = ending })} testId="send-ending-sequence" />
{:else if node.type === 'notify'}
  <div class="macro-row">
    <label>Level<select data-testid="notify-level" value={node.level} onchange={(event) => onUpdate((item: FlowV2Node) => { if (item.type === 'notify') item.level = event.currentTarget.value as NotificationLevel })}><option value="info">info</option><option value="success">success</option><option value="warning">warning</option><option value="error">error</option></select></label>
    <label>On failure<select data-testid="notify-on-failure" value={node.onFailure} onchange={(event) => onUpdate((item: FlowV2Node) => { if (item.type === 'notify') item.onFailure = event.currentTarget.value as 'continue' | 'pause' | 'fail' })}><option value="continue">continue</option><option value="pause">pause</option><option value="fail">fail</option></select></label>
  </div>
  <TemplatableScalarField label="Title" value={node.title} onChange={(value) => onUpdate((item: FlowV2Node) => { if (item.type === 'notify') item.title = value })} {templateScope} testId="notify-title" />
  <MessagePartsEditor message={node.message} onChange={(message: MessageSpec) => onUpdate((item: FlowV2Node) => { if (item.type === 'notify') item.message = message })} choices={artifactChoices} {templateScope} />
  <div class="message-part-row card" data-testid="notify-channels">
    <div class="step-title"><strong>Channels</strong></div>
    <div class="macro-row">
      <label class="checkbox-row"><input type="checkbox" data-testid="notify-channel-app" checked={Boolean(notifyChannel('app'))} onchange={(event) => setNotifyChannelEnabled('app', event.currentTarget.checked)} />app</label>
      <label class="checkbox-row"><input type="checkbox" data-testid="notify-channel-system" checked={Boolean(notifyChannel('system'))} onchange={(event) => setNotifyChannelEnabled('system', event.currentTarget.checked)} />system</label>
      <label class="checkbox-row"><input type="checkbox" data-testid="notify-channel-telegram" checked={Boolean(notifyChannel('telegram'))} onchange={(event) => setNotifyChannelEnabled('telegram', event.currentTarget.checked)} />telegram</label>
    </div>
    {#if notifyChannel('app')?.kind === 'app'}
      {@const appChannel = notifyChannel('app')}
      {#if appChannel?.kind === 'app'}
        <div class="macro-row">
          <label class="checkbox-row"><input type="checkbox" data-testid="notify-app-toast" checked={appChannel.toast} onchange={(event) => updateNotifyChannel('app', (channel) => { if (channel.kind === 'app') channel.toast = event.currentTarget.checked })} />Toast</label>
          <label>Sound<select data-testid="notify-app-sound" value={appChannel.sound} onchange={(event) => updateNotifyChannel('app', (channel) => { if (channel.kind === 'app') channel.sound = event.currentTarget.value as 'none' | 'bell' | 'chime' | 'ping' | 'pulse' | 'success' | 'warning' | 'alert' })}><option value="success">success</option><option value="bell">bell</option><option value="chime">chime</option><option value="ping">ping</option><option value="pulse">pulse</option><option value="warning">warning</option><option value="alert">alert</option><option value="none">none</option></select></label>
          <label>Repeat count<input type="number" min="1" max="10" step="1" data-testid="notify-app-repeat-count" value={appChannel.repeatCount} oninput={(event) => updateNotifyChannel('app', (channel) => { if (channel.kind === 'app') channel.repeatCount = Number(event.currentTarget.value) })} /></label>
          <label>Interval ms<input type="number" min="250" max="60000" step="1" data-testid="notify-app-repeat-interval-ms" value={appChannel.repeatIntervalMs} oninput={(event) => updateNotifyChannel('app', (channel) => { if (channel.kind === 'app') channel.repeatIntervalMs = Number(event.currentTarget.value) })} /></label>
        </div>
      {/if}
    {/if}
    {#if notifyChannel('telegram')?.kind === 'telegram'}
      {@const telegramChannel = notifyChannel('telegram')}
      {#if telegramChannel?.kind === 'telegram'}
        <label>Telegram profile<select data-testid="notify-telegram-profile" value={telegramChannel.profileId} onchange={(event) => updateNotifyChannel('telegram', (channel) => { if (channel.kind === 'telegram') channel.profileId = event.currentTarget.value })}>{#each telegramProfileChoices(telegramChannel.profileId) as profileId}<option value={profileId}>{profileId}</option>{/each}</select></label>
        {#if telegramProfilesError}<p class="macro-insertion-notice alert alert-warning py-2 text-xs" data-testid="notify-telegram-profile-status">Telegram profiles unavailable: {telegramProfilesError}</p>{/if}
      {/if}
    {/if}
  </div>
{:else if node.type === 'input'}
  <label>Target tab
    <MacroTerminalSelect testId="input-terminal" reference={node.terminal} expectedType={expectedTerminalTypeAt(node.terminal)} choices={terminalChoices()} onChange={(terminal) => onUpdateTerminal(terminal, (item: FlowV2Node) => { if (item.type === 'input') item.terminal = terminal })} />
  </label>
  <TemplatableScalarField label="Prompt" value={node.prompt} onChange={(value) => onUpdate((item: FlowV2Node) => { if (item.type === 'input') item.prompt = value })} {templateScope} testId="input-prompt" multiline maxRows={3} />
  <label class="checkbox-row"><input type="checkbox" data-testid="input-allow-empty" checked={node.allowEmpty} onchange={(event) => onUpdate((item: FlowV2Node) => { if (item.type === 'input') item.allowEmpty = event.currentTarget.checked })} />Allow empty</label>
  <TerminalInputDeliveryField value={node.delivery} onChange={(delivery: TerminalInputDelivery) => onUpdate((item: FlowV2Node) => { if (item.type === 'input') item.delivery = delivery })} testId="input-input-delivery" />
  <TerminalEndingField value={node.ending} onChange={(ending: TerminalEnding) => onUpdate((item: FlowV2Node) => { if (item.type === 'input') item.ending = ending })} testId="input-ending-sequence" />
  <label>Default source
    <select data-testid="input-default-source" value={node.defaultSource ? artifactSourceKey(node.defaultSource) : ''} onchange={(event) => onUpdate((item: FlowV2Node) => { if (item.type !== 'input') return; item.defaultSource = assignedArtifactSourceFromKey(event.currentTarget.value) })}>
      <option value="">none</option>{#each artifactChoices as choice}<option value={artifactSourceKey(choice.source)}>{choice.label}</option>{/each}
    </select>
  </label>
{:else if node.type === 'wait'}
  <label>Mode
    <select data-testid="wait-mode" value={node.mode} onchange={(event) => {
      const previous = node.mode
      if (!setNodeWaitMode(event.currentTarget.value)) event.currentTarget.value = previous
    }}>
      <option value="duration">duration</option><option value="terminal-quiet">terminal-quiet</option><option value="user-continue">user-continue</option>
    </select>
  </label>
  {#if node.mode === 'duration'}
    <label>Duration ms<input data-testid="wait-duration-ms" type="number" value={node.durationMs} oninput={(event) => onUpdate((item: FlowV2Node) => { if (item.type === 'wait' && item.mode === 'duration') item.durationMs = Number(event.currentTarget.value) })} /></label>
  {:else if node.mode === 'terminal-quiet'}
    <label>Target tab<MacroTerminalSelect testId="wait-target-tab" reference={node.terminal} expectedType={expectedTerminalTypeAt(node.terminal)} choices={quietTerminalChoices()} allChoices={terminalChoices()} onChange={(terminal) => onUpdateTerminal(terminal, (item: FlowV2Node) => { if (item.type === 'wait' && item.mode === 'terminal-quiet') item.terminal = terminal })} /></label>
    <div class="macro-row"><label>Quiet ms<input data-testid="wait-quiet-ms" type="number" value={node.quietMs} oninput={(event) => onUpdate((item: FlowV2Node) => { if (item.type === 'wait' && item.mode === 'terminal-quiet') item.quietMs = Number(event.currentTarget.value) })} /></label><label>Max ms<input data-testid="wait-max-ms" type="number" value={node.maxMs} oninput={(event) => onUpdate((item: FlowV2Node) => { if (item.type === 'wait' && item.mode === 'terminal-quiet') item.maxMs = Number(event.currentTarget.value) })} /></label><label>On timeout<select data-testid="wait-on-timeout" value={node.onTimeout} onchange={(event) => onUpdate((item: FlowV2Node) => { if (item.type === 'wait' && item.mode === 'terminal-quiet') item.onTimeout = event.currentTarget.value as 'pause' | 'finish' })}><option value="pause">pause</option><option value="finish">finish</option></select></label></div>
  {:else}
    <TemplatableScalarField label="Prompt" value={node.prompt} onChange={(value) => onUpdate((item: FlowV2Node) => { if (item.type === 'wait' && item.mode === 'user-continue') item.prompt = value })} {templateScope} testId="wait-user-continue-prompt" multiline maxRows={3} />
  {/if}
{:else if node.type === 'capture-source'}
  <CaptureSourceEditor
    variant="root"
    capture={node.capture}
    allowedKinds={captureKindsForReference(node.capture.terminal)}
    captureAllowed={captureAllowed(node.capture)}
    {terminalChoices}
    expectedTerminalType={expectedTerminalTypeAt(node.capture.terminal)}
    onTerminalChange={setCaptureTerminal}
    onKindChange={setCaptureKind}
    onChange={(capture) => setCapture(capture as CaptureSourceConfig)}
  />
{:else if node.type === 'extract_text'}
  <ExtractTextEditor
    variant="root"
    {node}
    choices={artifactChoices}
    onUpdate={(mutator) => onUpdate((item: FlowV2Node) => { if (item.type === 'extract_text') mutator(item as EditableExtractTextNode) })}
  />
{/if}
