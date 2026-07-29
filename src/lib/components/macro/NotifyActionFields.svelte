<script lang="ts">
  import type {
    NotificationLevel,
    NotifyChannel,
    NotifyNode,
  } from '../../macro/macroDefinitionTypes'
  import type { ArtifactChoice } from '../../macro/macroArtifactChoices'
  import { defaultNotifyChannel } from '../../macro/macroEditorDefaults'
  import type { TextTemplateScope } from '../../macro/scopedTextTemplateEditor'
  import MessagePartsEditor from './MessagePartsEditor.svelte'
  import TemplatableScalarField from './TemplatableScalarField.svelte'

  let {
    node,
    artifactChoices,
    templateScope,
    onUpdate,
    telegramProfileIds = [],
    telegramProfilesError = '',
  } = $props<{
    node: NotifyNode
    artifactChoices: ArtifactChoice[]
    templateScope: TextTemplateScope | null
    onUpdate: (mutator: (node: NotifyNode) => void) => void
    telegramProfileIds?: string[]
    telegramProfilesError?: string
  }>()

  function notifyChannel(kind: NotifyChannel['kind']): NotifyChannel | undefined {
    return node.channels.find((channel: NotifyChannel) => channel.kind === kind)
  }

  function setChannelEnabled(kind: NotifyChannel['kind'], enabled: boolean): void {
    onUpdate((item: NotifyNode) => {
      const exists = item.channels.some((channel: NotifyChannel) => channel.kind === kind)
      if (enabled && !exists) item.channels.push(defaultNotifyChannel(kind))
      if (!enabled) item.channels = item.channels.filter((channel: NotifyChannel) => channel.kind !== kind)
    })
  }

  function updateChannel(
    kind: NotifyChannel['kind'],
    mutator: (channel: NotifyChannel) => void,
  ): void {
    onUpdate((item: NotifyNode) => {
      let channel = item.channels.find((candidate: NotifyChannel) => candidate.kind === kind)
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
</script>

<div class="macro-row">
  <label>Level<select class="select box-border select-xs select-ghost w-full bg-base-content/15" data-testid="notify-level" value={node.level} onchange={(event) => onUpdate((item: NotifyNode) => { item.level = event.currentTarget.value as NotificationLevel })}><option value="info">info</option><option value="success">success</option><option value="warning">warning</option><option value="error">error</option></select></label>
  <label>On failure<select class="select box-border select-xs select-ghost w-full bg-base-content/15" data-testid="notify-on-failure" value={node.onFailure} onchange={(event) => onUpdate((item: NotifyNode) => { item.onFailure = event.currentTarget.value as 'continue' | 'pause' | 'fail' })}><option value="continue">continue</option><option value="pause">pause</option><option value="fail">fail</option></select></label>
</div>
<TemplatableScalarField label="Title" value={node.title} onChange={(value) => onUpdate((item: NotifyNode) => { item.title = value })} {templateScope} testId="notify-title" />
<MessagePartsEditor message={node.message} onUpdate={(mutator) => onUpdate((item: NotifyNode) => mutator(item.message))} choices={artifactChoices} {templateScope} />
<div class="message-part-row card" data-testid="notify-channels">
  <div class="step-title"><strong>Channels</strong></div>
  <div class="macro-row">
    <label class="checkbox-row"><input class="checkbox checkbox-xs" type="checkbox" data-testid="notify-channel-app" checked={Boolean(notifyChannel('app'))} onchange={(event) => setChannelEnabled('app', event.currentTarget.checked)} />app</label>
    <label class="checkbox-row"><input class="checkbox checkbox-xs" type="checkbox" data-testid="notify-channel-system" checked={Boolean(notifyChannel('system'))} onchange={(event) => setChannelEnabled('system', event.currentTarget.checked)} />system</label>
    <label class="checkbox-row"><input class="checkbox checkbox-xs" type="checkbox" data-testid="notify-channel-telegram" checked={Boolean(notifyChannel('telegram'))} onchange={(event) => setChannelEnabled('telegram', event.currentTarget.checked)} />telegram</label>
  </div>
  {#if notifyChannel('app')?.kind === 'app'}
    {@const appChannel = notifyChannel('app')}
    {#if appChannel?.kind === 'app'}
      <div class="macro-row">
        <label class="checkbox-row"><input class="checkbox checkbox-xs" type="checkbox" data-testid="notify-app-toast" checked={appChannel.toast} onchange={(event) => updateChannel('app', (channel) => { if (channel.kind === 'app') channel.toast = event.currentTarget.checked })} />Toast</label>
        <label>Sound<select class="select box-border select-xs select-ghost w-full bg-base-content/15" data-testid="notify-app-sound" value={appChannel.sound} onchange={(event) => updateChannel('app', (channel) => { if (channel.kind === 'app') channel.sound = event.currentTarget.value as 'none' | 'bell' | 'chime' | 'ping' | 'pulse' | 'success' | 'warning' | 'alert' })}><option value="success">success</option><option value="bell">bell</option><option value="chime">chime</option><option value="ping">ping</option><option value="pulse">pulse</option><option value="warning">warning</option><option value="alert">alert</option><option value="none">none</option></select></label>
        <label>Repeat count<input class="input box-border input-xs input-ghost w-full bg-base-content/15" type="number" min="1" max="10" step="1" data-testid="notify-app-repeat-count" value={appChannel.repeatCount} oninput={(event) => updateChannel('app', (channel) => { if (channel.kind === 'app') channel.repeatCount = Number(event.currentTarget.value) })} /></label>
        <label>Interval ms<input class="input box-border input-xs input-ghost w-full bg-base-content/15" type="number" min="250" max="60000" step="1" data-testid="notify-app-repeat-interval-ms" value={appChannel.repeatIntervalMs} oninput={(event) => updateChannel('app', (channel) => { if (channel.kind === 'app') channel.repeatIntervalMs = Number(event.currentTarget.value) })} /></label>
      </div>
    {/if}
  {/if}
  {#if notifyChannel('telegram')?.kind === 'telegram'}
    {@const telegramChannel = notifyChannel('telegram')}
    {#if telegramChannel?.kind === 'telegram'}
      <label>Telegram profile<select class="select box-border select-xs select-ghost w-full bg-base-content/15" data-testid="notify-telegram-profile" value={telegramChannel.profileId} onchange={(event) => updateChannel('telegram', (channel) => { if (channel.kind === 'telegram') channel.profileId = event.currentTarget.value })}>{#each telegramProfileChoices(telegramChannel.profileId) as profileId}<option value={profileId}>{profileId}</option>{/each}</select></label>
      {#if telegramProfilesError}<p class="macro-insertion-notice alert alert-warning py-2 text-xs" data-testid="notify-telegram-profile-status">Telegram profiles unavailable: {telegramProfilesError}</p>{/if}
    {/if}
  {/if}
</div>
