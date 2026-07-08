# Contract

## Tab Capability Model

Introduce a single helper that maps a live `TerminalSnapshot.backend` to editor capabilities.

```ts
type TabCapabilityKind = "shell" | "text"

type TabCapabilities = {
  kind: TabCapabilityKind
  canSendLine: boolean
  canInputLine: boolean
  canWaitQuiet: boolean
  captureKinds: Array<"terminal-buffer" | "text-box" | "agent-event">
}
```

Capability mapping:

| backend | displayed kind | send_line | input_line | terminal-quiet | capture kinds |
| --- | --- | --- | --- | --- | --- |
| `real` | `shell` | yes | yes | yes | `terminal-buffer`, `agent-event` |
| `fake` | `shell` | yes | yes | yes | `terminal-buffer`, `agent-event` |
| `text` | `text` | yes | yes | no | `text-box` |

Notes:

* `send_line` remains valid for text tabs: it appends rendered text as collected text.
* `input_line` remains valid for text tabs: runtime user input appends to the text tab.
* `agent-event` is shell-like in V0 because the supported producer is `just codex`, which runs inside shell/fake/real tabs with hook env.
* The helper must be the single source for Macro editor filtering. Do not duplicate backend string checks across components.

## UI Rules

### Target Tab Selectors

`send_line` and `input_line` target selectors show all tabs because both shell and text tabs support incoming text.

`wait(mode = terminal-quiet)` target selector shows only tabs with `canWaitQuiet = true`.

If no quiet-capable tab exists:

* `terminal-quiet` mode is disabled in the mode selector.
* Existing imported templates that use `terminal-quiet` should display a validation issue instead of hiding the node.

If an existing `terminal-quiet` node resolves to a text tab:

* The editor must show a visible validation issue.
* The selector should offer only quiet-capable tabs for repair.
* The editor must not silently rewrite the user target.

### Capture Source Editor

`capture-source` is source-tab-first:

1. User selects `Source tab`.
2. The editor derives allowed capture kinds from the selected tab.
3. Capture kind UI is filtered or collapsed according to capabilities.

Rules:

* Source tab = shell/fake/real:
  * allowed kinds: `terminal-buffer`, `agent-event`
  * show terminal-buffer mode controls for `terminal-buffer`
  * show Agent/Mode controls for `agent-event`
* Source tab = text:
  * allowed kind: `text-box`
  * do not show a three-option capture kind selector
  * show a short hint: `captures this text tab as plain text`

Changing the source tab:

* If the current capture kind is still allowed, preserve it.
* If it is no longer allowed, switch to the first allowed capture kind for that tab and keep the same terminal ref.
* This auto-conversion is allowed because it is a direct result of the user's explicit source tab change and avoids leaving an impossible state.

### Parallel Lane Editor

A lane's `Lane tab` controls lane-local capabilities.

Allowed lane body actions by lane tab:

| lane tab kind | allowed lane actions |
| --- | --- |
| shell | `send_line`, `wait`, `capture-source`, `extract_text`, fixed final `Output` |
| text | `send_line`, `capture-source`, `extract_text`, fixed final `Output` |

Lane-specific rules:

* For text lanes, do not offer `wait` in the lane insertion palette.
* For text lanes, lane capture-source defaults to `text-box` and does not show shell-only capture kinds.
* For shell lanes, lane capture-source defaults to `terminal-buffer`; `agent-event` remains available.
* If the user changes a lane tab from shell to text while the lane body contains incompatible actions, block the lane-tab change and show a visible notice listing the incompatible action ids.
* If the user changes a lane tab from text to shell, keep compatible actions and allow adding shell-only actions afterwards.

## Validation And Preflight

Schema validation remains structural and should not require live terminal snapshots. Capability validation belongs to editor validation and runner preflight because it depends on current config tab state.

Preflight must reject:

* `wait.mode = terminal-quiet` targeting a text tab.
* `capture.kind = terminal-buffer` targeting a text tab.
* `capture.kind = agent-event` targeting a text tab.
* `capture.kind = text-box` targeting a shell/fake/real tab.
* Parallel lane body containing `wait.terminal-quiet` when lane tab is text.
* Parallel lane capture action whose kind is not allowed by the lane tab capability.

Error messages must name the action id, target/source/lane tab alias, and required capability.

## Scope Boundary

This task does not rename JSON fields. Examples continue to use:

```json
{ "terminal": { "kind": "alias", "value": "shell_1" } }
```

Do not introduce a second `tab` field into macro JSON.
