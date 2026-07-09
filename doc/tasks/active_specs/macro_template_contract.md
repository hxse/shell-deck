# Macro Template Contract

## Template Storage

Macro templates are JSON documents stored per config. New/imported runnable templates use `schemaVersion: 2` and a structured `body` block tree.

Templates do not store Codex session ids. Templates refer to deck tabs through structured terminal refs: index, id, or alias. The JSON field remains `terminal` for runner/protocol compatibility, but the macro editor labels selectors by usage: `Target tab` for send/input/wait targets, `Source tab` for capture sources, and `Lane tab` inside parallel lanes. Each selector presents a live tab as one merged row with index, alias, kind, and hover details for the full id mapping. Existing index/id/alias targets resolve through the current config `indexMap`, so tab reorder and alias rename are reflected by the next render without users manually syncing the three forms.

## Tab Capability Model

Macro editor controls and runner start preflight are capability-aware when live deck tab snapshots are available. Structural template validation remains capability-agnostic when only JSON is available.

Live tab capabilities are derived from `TerminalSnapshot.backend`:

- `fake` and `real` are shell tabs: `send`, `input`, `wait.terminal-quiet`, `capture-source.terminal-buffer`, and `capture-source.agent-event` are available.
- `text` is a text tab: `send`, `input`, and `capture-source.text-box` are available; `wait.terminal-quiet`, `terminal-buffer`, and `agent-event` are not available.

If an imported or edited template points a shell-only action at a text tab, the editor must show validation instead of silently rewriting it. When the user explicitly changes a Source tab or Lane tab, the UI may convert to the first valid capture kind or block the change with a visible notice when existing actions are incompatible. Runner start preflight must reject live capability-invalid templates before execution. Error messages should name the action id, the tab alias, and the required capability.


Shell-deck only supports the current macro template schema: `schemaVersion: 2` with a structured `body` block tree. Files or imports that do not validate against the current schema are invalid templates. The template store must fail loudly with `invalid_macro_template`; it must not skip, migrate, quarantine, silently ignore, or treat old formats as compatibility objects.

## Action Types

Flow V2 supports these action nodes:

- `send`
- `input`
- `wait`
- `capture-source`
- `extract_text`
- `parallel`

Flow V2 controls:

- `if` / `elif` / `else`
- `for`
- `break`
- `continue`
- `finish`

Invalid removed nodes and fields include `send_line`, `input_line`, `sleep`, `parse`, `parser`, `ai-json`, `branch`, `goto`, `next`, `loopGuard`, `pause`, `stop`, `complete`, `fail`, `parallel_all`, `merge_parallel_results`, and `send_artifact`.

## Message Flow

`send` writes rendered message text to a target tab. It stores explicit `enter: boolean`; new UI nodes default to `enter: true`.

`send.message.parts` is an ordered list. It may be empty. Each part is either literal text or a source artifact reference. An artifact part with no `source` means `none` and contributes an empty string. The runner concatenates parts in order without adding implicit separators and without trimming leading or trailing whitespace. Newline characters inside text or artifacts are user content.

```json
{
  "id": "send_review",
  "type": "send",
  "terminal": { "kind": "alias", "value": "worker" },
  "message": {
    "parts": [
      { "kind": "text", "text": "修复这些问题:\n\n" },
      { "kind": "artifact", "source": { "kind": "step_artifact", "stepId": "capture_review", "artifact": "captured_text" } }
    ]
  },
  "enter": true
}
```

`input` pauses for user text. It stores a fixed `prompt`, `allowEmpty`, explicit `enter: boolean`, and optional single `defaultSource`. If `defaultSource` is present, the runner pre-fills the runtime textarea with that artifact text; the user can edit it. The final textarea content is raw user content and is not trimmed. `allowEmpty = false` rejects only zero-length input.

Macro submit uses LF. Runtime write payload is `content + (enter ? "\n" : "")` for shell/fake/real and text tabs. The macro layer must not append CR. Template JSON must not mutate `message` or user input to include the submit sequence; runtime `terminal_text_sent` events record both `content.artifactRef` and exact `write.artifactRef`, plus `enter` and `enterSequence = lf | none`.

## Wait Modes

`wait` only waits; it does not produce artifacts.

- `duration`: fixed wait in milliseconds.
- `terminal-quiet`: waits until a shell tab has no output for `quietMs`, up to `maxMs`. It is only valid for `backend = fake | real` tabs and must not target `backend = text` tabs.
- `user-continue`: pauses until the user resumes.

`capture-ready-or-user` is unsupported. Capture readiness belongs to the explicit `capture-source` step.

## Capture Source

`capture-source` is the only macro action that obtains text from a source tab or agent.

- `terminal-buffer`: captures shell/fake/real tab scrollback tail and produces `captured_text`. It is invalid for `backend = text` tabs. `mode = scrollback-tail` is the default visible-screen-text renderer; `mode = raw-stream-tail` returns the raw PTY tail for debugging/direct stream forwarding.
- `text-box`: captures a `backend = text` tab as plain text and produces `captured_text`. It is invalid for shell/fake/real tabs. It has no terminal screen/raw stream semantics.
- `agent-event`: captures explicit Codex hook events from shell/fake/real tabs; it is invalid for `backend = text` tabs. V0 supports `agent.kind = codex` and required `captureMode = result_only | prompt_only | prompt_and_result`. It only uses `UserPromptSubmit.prompt` and `Stop.last_assistant_message`; transcript, reasoning, tool calls, and intermediate steps are out of scope.

## Text Extraction

`extract_text` is the deterministic text-processing action. It reads an earlier text artifact, splits it, filters segments, selects segments, optionally extracts a regex group, and writes `extracted_text`. It does not call AI and does not return boolean signals.

Supported structure:

- `source`: visible predecessor artifact, including `captured_text`, `merged_text`, or `extracted_text`.
- `split`: `lines` or `regex`, with `keepEmpty`.
- `filters`: ordered `include` / `exclude` filters using simple text ops or regex.
- `select`: `all`, zero-based `index`, or zero-based `range`. `index`, `range.start`, and `range.end` support negative values, so `index: -1` selects the last segment. `first` / `last` are not saved as standalone modes.
- `extract`: `none` or `regex` group / named group.
- `trim`: `none`, `left`, `right`, `both`.
- `onEmpty`: `pause`, `continue`, `fail`, or `finish`. `continue` follows normal loop control semantics: inside `for` it skips the rest of the current iteration; outside a loop it is treated like escaped control and pauses the run.

## Text Conditions

There is no standalone `parse` action in Flow V2. Text matching lives inside structured `if.text_match` conditions and returns a boolean. Use `extract_text` when the workflow needs a new text artifact rather than a boolean branch.

Matchers:

- simple: `contains`, `not_contains`, `equals`, `not_equals`, `starts_with`, `ends_with`
- regex: JavaScript regex with flags limited to `i`, `m`, `s`

Scopes:

- `whole`
- `lines.first`
- `lines.last`
- `lines.any`
- `lines.all`

## Runner Semantics

A config can have at most one live macro run. Live includes running, paused, waiting, waiting for input, or interrupted. Starting a second live run in the same config is rejected. Another config may run independently.

`pause` and `stop` are runner controls, not template nodes. Completion is represented by `finish`.

`for.range` supports two modes:

- count: `{ "kind": "count", "count": 3 }`; reading legacy `{ "count": 3 }` is allowed, but new UI writes explicit `kind`.
- forever: `{ "kind": "forever" }`; it runs until `break`, `finish`, stop, or fail, and must not store `count`.

`finish`, `break`, and `continue` may include an optional action-only `body`. The runner executes that body first; only after the body completes does the control transfer take effect. The body may contain ordinary action nodes only. It must not contain `if`, `for`, `finish`, `break`, or `continue`.

## Parallel

`parallel` is the only bounded parallel primitive. It is a lane-tab fan-out/fan-in action: every lane runs a restricted sequential body and ends with a fixed `Output` node.

Each lane:

- has an id unique within the parent parallel node
- has a non-empty label unique within the parent parallel node when set
- chooses one unique Lane tab
- allows ordinary `send` actions before Output
- allows `wait` only when the Lane tab is shell/fake/real; text lanes do not expose or accept wait actions
- shell/fake/real lanes may use `wait.duration` or `wait.terminal-quiet`; lane `terminal-quiet.onTimeout` must be `pause`
- shell/fake/real lanes may capture `terminal-buffer` or `agent-event`
- text lanes may capture `text-box` only
- allows `extract_text` actions before Output
- lane-local `extract_text.onEmpty` is limited to `pause` or `fail`

Each lane has a mandatory final `Output`; the action mechanically merges lane outputs into one `merged_text` artifact. Downstream `extract_text`, `send`, or `if.text_match` can reference that artifact.

It does not allow nested parallel, lane-local `input`, parse/AI action, or lane-local `if/for/break/continue/finish`. `Output` is mandatory, final, and not deletable.
