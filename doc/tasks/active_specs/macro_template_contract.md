# Macro Template Contract

## Template Storage

Macro templates are JSON documents stored per config. New/imported runnable templates use `schemaVersion: 2` and a structured `body` block tree.

Templates do not store Codex session ids. Templates refer to terminals by structured refs: index, id, or alias.

Shell-deck only supports the current macro template schema: `schemaVersion: 2` with a structured `body` block tree. Files or imports that do not validate against the current schema are invalid templates. The template store must fail loudly with `invalid_macro_template`; it must not skip, migrate, quarantine, silently ignore, or treat old formats as compatibility objects.

## Action Types

Flow V2 supports these action nodes:

- `send_line`
- `input_line`
- `wait`
- `capture-source`
- `extract_text`
- `parallel_send_capture`

Flow V2 controls:

- `if` / `elif` / `else`
- `for`
- `break`
- `continue`
- `return`

Invalid removed nodes and fields include `sleep`, `parse`, `parser`, `ai-json`, `branch`, `goto`, `next`, `loopGuard`, `pause`, `stop`, `complete`, `fail`, `parallel_all`, `merge_parallel_results`, and `send_artifact`.

## Message Flow

`send_line` writes the rendered message to a target deck slot. For shell/fake terminals it sends Enter; for `backend = text` slots it appends the rendered text as collected text. It does not distinguish prompts from shell commands.

`send_line.message.parts` is an ordered list. Each part is either literal text or a source artifact reference. The runner concatenates parts in order without adding implicit separators.

```json
{
  "id": "send_review",
  "type": "send_line",
  "terminal": { "kind": "alias", "value": "worker" },
  "message": {
    "parts": [
      { "kind": "text", "text": "修复这些问题:\n\n" },
      { "kind": "artifact", "source": { "kind": "step_artifact", "stepId": "capture_review", "artifact": "captured_text" } }
    ]
  }
}
```

`input_line` pauses for user text. It stores a fixed `prompt`, `allowEmpty`, and optional single `defaultSource`. If `defaultSource` is present, the runner pre-fills the runtime textarea with that artifact text; the user can edit it, and the final textarea content is sent to the terminal with Enter.

## Wait Modes

`wait` only waits; it does not produce artifacts.

- `duration`: fixed wait in milliseconds.
- `terminal-quiet`: waits until a terminal has no output for `quietMs`, up to `maxMs`.
- `user-continue`: pauses until the user resumes.

`capture-ready-or-user` is unsupported. Capture readiness belongs to the explicit `capture-source` step.

## Capture Source

`capture-source` is the only macro action that obtains text from a terminal or agent.

- `terminal-buffer`: captures terminal scrollback tail and produces `captured_text`. `mode = scrollback-tail` is the default visible-screen-text renderer; `mode = raw-stream-tail` returns the raw PTY tail for debugging/direct stream forwarding.
- `text-box`: captures a `backend = text` deck slot as plain text and produces `captured_text`. It has no terminal screen/raw stream semantics.
- `agent-event`: captures an explicit agent event; V0 supports `agent.kind = codex`, `eventKind = stop`, `field = last_assistant_message`.

## Text Extraction

`extract_text` is the deterministic text-processing action. It reads an earlier text artifact, splits it, filters segments, selects segments, optionally extracts a regex group, and writes `extracted_text`. It does not call AI and does not return boolean signals.

Supported structure:

- `source`: visible predecessor artifact, including `captured_text`, `merged_text`, or `extracted_text`.
- `split`: `lines` or `regex`, with `keepEmpty`.
- `filters`: ordered `include` / `exclude` filters using simple text ops or regex.
- `select`: `first`, `last`, `all`, zero-based `index`, or zero-based `range`.
- `extract`: `none` or `regex` group / named group.
- `trim`: `none`, `left`, `right`, `both`.
- `onEmpty`: `pause`, `fail`, or `return`.

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

`pause` and `stop` are runner controls, not template nodes. Completion is represented by `return`.

## Parallel Send Capture

`parallel_send_capture` is the only bounded parallel primitive. It is a limited fan-out/fan-in action, not a lane-local workflow language.

Each item:

- chooses one unique terminal
- reuses normal `send_line` schema for the send
- may use a normal `wait` with `duration` or `terminal-quiet`; item `terminal-quiet.onTimeout` must be `pause`
- reuses normal `capture-source` schema for capture

The action mechanically merges all item captures into one `merged_text` artifact. Downstream `extract_text`, `send_line`, or `if.text_match` can reference that artifact.

It does not allow nested parallel, item-local `input_line`, parse/AI action, or item-local `if/for/break/continue/return`.
