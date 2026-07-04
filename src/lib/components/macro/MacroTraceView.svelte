<script lang="ts">
  import type { RunLogUpdatedMessage } from '../../protocol'
  import RunLogView from '../RunLogView.svelte'

  let { configId, refreshToken = 0, refreshEvent = null, templateId, templateName } = $props<{
    configId: string
    refreshToken?: number
    refreshEvent?: RunLogUpdatedMessage | null
    templateId: string | null
    templateName: string | null
  }>()
</script>

<RunLogView {configId} {refreshToken} {refreshEvent} {templateId} {templateName} />
