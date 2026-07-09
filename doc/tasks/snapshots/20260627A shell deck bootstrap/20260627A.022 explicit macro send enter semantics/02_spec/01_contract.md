# Contract

## Action Set

After this task, Flow V2 supports these action nodes:

* `send`
* `input`
* `wait`
* `capture-source`
* `extract_text`
* `parallel`

Removed action nodes:

* `send_line`
* `input_line`

Templates using removed action names are invalid templates. The store, importer, schema validation, editor, and runner must fail loudly; they must not migrate, rewrite, quarantine, or silently ignore old templates.

## Send Action

`send` writes rendered message text to a target tab.

Required fields:

```json
{
  "id": "send_review",
  "type": "send",
  "terminal": { "kind": "alias", "value": "shell_1" },
  "message": {
    "parts": [
      { "kind": "text", "text": "hello text" }
    ]
  },
  "enter": true
}
```

Rules:

* `message.parts` remains an ordered list of literal text and artifact references.
* The runner concatenates message parts in order without implicit separators.
* The runner must not trim leading or trailing whitespace.
* Newline characters inside literal text or artifacts are user content and must be sent as content.
* `enter` is required and must be a boolean.
* New `send` nodes created by the UI default to `enter: true`.

## Input Action

`input` pauses for user-provided text, then writes that text to a target tab.

Required fields:

```json
{
  "id": "ask_direction",
  "type": "input",
  "terminal": { "kind": "alias", "value": "shell_1" },
  "prompt": "Direction",
  "allowEmpty": false,
  "enter": true
}
```

Optional field:

```json
{
  "defaultSource": {
    "kind": "step_artifact",
    "stepId": "capture_review",
    "artifact": "captured_text"
  }
}
```

Rules:

* Runtime user input is raw user content; the runner must not trim it.
* `allowEmpty = false` rejects only zero-length input. Whitespace-only input is not empty.
* Newline characters inside user input are content and must be sent as content.
* `enter` is required and must be a boolean.
* New `input` nodes created by the UI default to `enter: true`.

## Submit Sequence

ShellDeck defines one submit sequence for macro `enter: true`:

```ts
const MACRO_ENTER_SEQUENCE = "\n"
```

Runtime write payload:

```ts
payload = content + (enter ? MACRO_ENTER_SEQUENCE : "")
```

This applies to shell/fake/real tabs and text tabs. The macro layer must not append `\r`. The lower terminal backend may still normalize direct non-macro input according to its own existing contract, but macro submit semantics are LF.

## Template Versus Runtime Evidence

Template JSON must not mutate `message` or user input to include the submit sequence.

Runtime event log must record both:

* content before submit sequence
* actual payload written to the tab

The send/input terminal-write event should use a neutral event name:

```json
{
  "kind": "terminal_text_sent",
  "stepId": "send_review",
  "data": {
    "terminalId": "term_x",
    "enter": true,
    "enterSequence": "lf",
    "content": {
      "artifactRef": "artifacts/send-content-xxx.txt",
      "chars": 10
    },
    "write": {
      "artifactRef": "artifacts/send-write-xxx.txt",
      "chars": 11
    }
  }
}
```

`content.artifactRef` stores the rendered/user content only. `write.artifactRef` stores the exact payload sent to `TerminalDeckManager.input`.

When `enter = false`, `enterSequence` is `"none"` and `write` equals `content`.

## UI Rules

Macro editor:

* `send` shows a `Submit with Enter` checkbox bound to `enter`.
* `input` shows a `Submit with Enter` checkbox bound to `enter`.
* Parallel lane `send` shows the same checkbox.
* New nodes default the checkbox to checked.
* UI must not auto-trim text inputs.
* UI may show a non-blocking warning when content already ends with `\n` and `enter = true`, but the template remains valid.

Runtime input dock:

* The user submits the paused `input` step as before.
* Whether terminal write includes LF is controlled by the template node's `enter` field, not by an extra runtime toggle.

## Parallel Lane Boundary

Parallel lanes support `send`, not `send_line`.

The lane terminal rule remains unchanged: a lane `send.terminal` must match the lane `terminal`. The only change is that lane `send` includes explicit `enter`.

## Validation And Preflight

Structural validation must reject:

* missing or non-boolean `send.enter`
* missing or non-boolean `input.enter`
* any `send_line` node
* any `input_line` node
* parallel lane nodes using `send_line`

Capability preflight from `.021` applies to `send` and `input` exactly as it applied to `send_line` and `input_line`: shell/fake/real and text tabs can receive text.

## Active Spec Sync

Implementation must update `doc/tasks/active_specs/macro_template_contract.md` after code and tests are aligned. The active spec must not mention `send_line` / `input_line` as supported current actions.
