<script lang="ts">
  import type { TerminalEnding } from "../../macro/templateTypes"

  let { value, onChange, testId } = $props<{
    value: TerminalEnding
    onChange: (ending: TerminalEnding) => void
    testId: string
  }>()
</script>

<label>Ending sequence
  <select data-testid={testId} {value} onchange={(event) => onChange(event.currentTarget.value as TerminalEnding)}>
    <option value="none">None</option>
    <option value="cr">Enter / CR (\r)</option>
    <option value="lf">LF (\n)</option>
    <option value="crlf">CRLF (\r\n)</option>
  </select>
</label>
