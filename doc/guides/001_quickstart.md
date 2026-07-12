# Quickstart

This guide exercises the V0 local path. It does not require network access unless you explicitly run online Codex probes or start the real `codex-exec` parser mode.

## Start And Stop

From the shell-deck repo:

```bash
cd <shell-deck-root>
just start
```

`just start` seeds the `local` config with two real shell terminals when it starts with an empty deck. Tests and explicit API calls can still create fake terminals.

Default URL:

```text
http://127.0.0.1:5177
```

Stop the default local server from another shell:

```bash
just stop
```

For a non-default port, pass the same port to both commands:

```bash
just start --port 5188
just stop --port 5188
```

The server refuses non-local binds unless `SHELL_DECK_ALLOW_LAN=1` is set. V0 has no access control, so local bind is the safe default.

## Parser Modes

V0 separates parser modes at the command entry point:

```bash
just start          # ai-json disabled; regex still works
just start-mock-ai  # explicit mock ai-json for offline demos/tests
just start-codex-ai # real codex exec parser; may use auth/network/model quota
```

Flow V2 does not expose `parse` or `ai-json` as macro actions. These parser-mode server entries remain for explicit developer probes and do not change the runnable macro language.

## Terminal Deck

Open two browser tabs to the same URL and config. Terminal output, terminal order, aliases, and replay are synchronized by the server. A fresh `just start` opens two real shell terminals by default.

Macro terminal refs use one of these complete JSON objects:

- `{ "kind": "index", "value": 1 }`: convenient dynamic position
- `{ "kind": "id", "value": "term_..." }`: stable terminal id
- `{ "kind": "alias", "value": "reviewer" }`: terminal tab rename alias

Each ref contains exactly `kind` and `value`. Macro JSON does not accept scalar terminal refs or additional fields.

Double-click a terminal tab to rename it. That alias is the macro-visible alias. Use the tab close button to remove a terminal; shell-deck asks for confirmation before closing. Dragging terminal tabs is behind the drag toggle to avoid accidental reorder.

## Hook-Enabled Codex

Use the shell-deck justfile wrapper from any target project when you want Codex hooks to report AgentEvents back to shell-deck:

```bash
cd /path/to/target/project
just -f <shell-deck-root>/justfile -- codex --help
just -f <shell-deck-root>/justfile -- codex exec -
```

The wrapper injects temporary hook config only for that Codex invocation. It forwards arguments to Codex and preserves terminal/config/launch ids through environment variables. V0 records Codex session ids for traceability but does not bind macro templates or macro state to Codex sessions.

## Workspace Panels

The top bar has Macro and Prompt toggles. Macro is visible by default; Prompt is hidden by default. Both side panels can be resized horizontally and reset to their default widths. Panel visibility and width are stored per config and synchronized across browser tabs connected to the same config.

The Prompt panel provides a compact Prompt Library with a searchable selector:

- project prompts scoped to the current config
- global prompts visible to all configs on the same server
- create/edit/delete with confirmation
- search by title, body, or tag
- edit/read body in one textarea and copy body to clipboard

Prompts are plain text records; V0.1 does not auto-send prompts to terminals and does not bind prompts to macros.

## Macro Template Flow

The macro workbench supports:

- searchable template selection
- template create/save/duplicate/delete with delete confirmation in one toolbar
- import/export JSON backups
- visual editing for nested Flow V2 bodies, including `if`, `for`, control action bodies, and bounded parallel lanes
- JSON preview/import/export for the complete `schemaVersion: 2` document
- structured branch conditions only; no expression strings and no JS eval

Flow V2 action nodes are `send`, `notify`, `input`, `wait`, `capture-source`, `extract_text`, and `parallel`. Control nodes are `if`, `for`, `break`, `continue`, and `finish`. A parallel lane ends with its mandatory `output` node; it is not a general top-level action.

A count loop always stores an explicit discriminator:

```json
{
  "id": "for_three",
  "type": "for",
  "range": { "kind": "count", "count": 3 },
  "body": [
    { "id": "wait_between", "type": "wait", "mode": "duration", "durationMs": 1000 }
  ]
}
```

The count range object contains exactly `kind` and the positive integer `count`.

Use a `text-list` range when the same body should run once for each structured item. Each item is exactly `{ "key": string, "value": string }`, with a user-editable single-line `key` and multiline `value`; the loop generates a pure one-based numeric `index` from its current position. Plain text remains literal, including braces. To interpolate the current item, explicitly enable the default-off `Use loop template` checkbox and insert exact `{{index}}`, `{{key}}`, or `{{value}}` tokens. Template parts accept only those three exact tokens.

```json
{
  "id": "for_phases",
  "type": "for",
  "range": {
    "kind": "text-list",
    "items": [
      {
        "key": "高频策略",
        "value": "处理信号最多的三个策略"
      },
      {
        "key": "边界策略",
        "value": "处理中高频回踩和边界策略"
      }
    ]
  },
  "body": [
    {
      "id": "send_phase",
      "type": "send",
      "terminal": { "kind": "alias", "value": "worker" },
      "message": {
        "parts": [
          { "kind": "template", "template": "阶段 {{index}}：{{key}}\n{{value}}" }
        ]
      },
      "ending": "cr"
    }
  ]
}
```

Every normal `send`, `input`, and parallel-lane `send` has one `Ending sequence` selector. New actions default to `Enter / CR (\r)`, which matches a physical Enter in xterm. Choose `None` to append nothing, `LF (\n)` for one line-feed byte, or `CRLF (\r\n)` for two explicit bytes. CRLF may be consumed as two separate inputs by a raw-mode TUI. The JSON field is always explicit and accepts `none`, `lf`, `cr`, or `crlf`:

```json
"ending": "cr"
```

Old `enter: true/false` templates are invalid. Shell-deck does not migrate or infer an ending for them; delete the old template or rewrite it using the current field.

Template mode is limited to six user-visible content surfaces:

- normal `send.message` text parts
- parallel-lane `send.message` text parts
- `notify.title`
- `notify.message` text parts
- `input.prompt`
- `wait.user-continue.prompt`

The checkbox is available only inside a lexical `text-list for` scope. `if` branches, control action bodies, inner count/forever loops, and parallel lanes inherit the complete index/key/value binding. An inner text-list shadows all three values until its body ends. Item Key and Value are binding sources and do not get template checkboxes. V0 does not provide outer-binding access, named variables, or a general expression language; all other strings remain literal or keep their existing field-specific grammar.

Macro multiline content editors keep one spare visual line, grow automatically to their row cap, and then scroll internally. You can drag them taller temporarily (up to 60% of the viewport); that manual height is intentionally not saved and resets when the editor is reopened or the page reloads.

## Macro Runner HTTP

Read the current runner snapshot with `GET /api/configs/<configId>/runner`. Control it with `POST /api/configs/<configId>/runner/<action>` and one of these exact JSON bodies:

| Action | JSON body |
| --- | --- |
| `start` | `{ "templateId": "tmpl_current" }` |
| `pause` | `{}` |
| `resume` | `{}` |
| `stop` | `{}` |
| `input` | `{ "text": "user input" }` |

The request object cannot contain additional fields. `templateId` must be a non-empty string. Input `text` may be empty at the HTTP boundary; the waiting node's `allowEmpty` setting decides whether the service accepts it. A zero-byte empty HTTP body is interpreted as `{}`, so it is valid only for pause/resume/stop; a whitespace-only body is malformed JSON. Malformed JSON, non-object JSON, missing or invalid required fields, and unknown fields return HTTP 422 before the action reaches the runner. Runtime state conflicts return HTTP 409. Resume always continues from the server-owned occurrence cursor.

## Observability

Each macro run writes one append-only event log plus artifacts. The visual node log and AI-readable trace derive from that same event log. Expand nodes to inspect inputs, waits, captures, extraction results, branch decisions, loop iterations, parallel lane events, and artifact refs.

## Offline Test Gate

The full V0 offline gate is:

```bash
just test-009-offline
```

Useful smaller gates:

```bash
just check
just build
just test-unit
just test-e2e
just test-001-offline
just test-006-offline
just test-007-offline
just test-008-offline
```

Online probes are explicit and optional:

```bash
just test-001-online
just test-006-online
just test-007-online
```

They may require Codex auth, network, and model quota. If unavailable, record the blocked reason instead of treating them as default failures.

## Known V0 Limits

- No authentication or access control; keep default local bind unless you understand the LAN risk.
- No Codex session binding or session restore; use `codex resume` manually in a terminal if needed.
- Normal pause/resume continues the exact dynamic macro occurrence only while the same runner runtime is alive. Server restart leaves an in-flight run interrupted; it does not hydrate and resume the execution cursor.
- Crash-safe exactly-once delivery is not guaranteed for the window where a terminal or notification side effect succeeds before its event/checkpoint is appended.

Run Log / AI Trace lives under the Macro Trace tab, follows the selected macro template, and updates from server run events automatically.
