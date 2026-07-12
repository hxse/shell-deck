# Macro Template Contract

## Template Storage

Macro templates are JSON documents stored per config. Every runnable template uses `schemaVersion: 2` and a structured `body` block tree.

Templates do not store Codex session ids. Templates refer to deck tabs through structured terminal refs: `{ "kind": "index", "value": positiveInt }`, `{ "kind": "id", "value": TerminalId }`, or `{ "kind": "alias", "value": PublicId }`. Every Macro TerminalRef is a JSON object with exactly the own enumerable fields `kind` and `value`; scalar refs and objects with additional fields are invalid. The only JSON field name for the reference is `terminal`, while the macro editor labels selectors by usage: `Target tab` for send/input/wait targets, `Source tab` for capture sources, and `Lane tab` inside parallel lanes. Each selector presents a live tab as one merged row with index, alias, kind, and hover details for the full id mapping. Index/id/alias targets resolve through the current config `indexMap`, so tab reorder and alias rename are reflected by the next render without users manually syncing the three forms.

## Tab Capability Model

Macro editor controls and runner start preflight are capability-aware when live deck tab snapshots are available. Structural template validation remains capability-agnostic when only JSON is available.

Live tab capabilities are derived from `TerminalSnapshot.backend`:

- `fake` and `real` are shell tabs: `send`, `input`, `wait.terminal-quiet`, `capture-source.terminal-buffer`, and `capture-source.agent-event` are available.
- `text` is a text tab: `send`, `input`, and `capture-source.text-box` are available; `wait.terminal-quiet`, `terminal-buffer`, and `agent-event` are not available.

If an imported or edited template points a shell-only action at a text tab, the editor must show validation instead of silently rewriting it. When the user explicitly changes a Source tab or Lane tab, the UI may convert to the first valid capture kind or block the change with a visible notice when existing actions do not support the selected tab. Runner start preflight must reject live capability-invalid templates before execution. Error messages should name the action id, the tab alias, and the required capability.


Shell-deck only supports the current macro template schema: `schemaVersion: 2` with a structured `body` block tree. Every file and import must validate completely before it can be listed, read, duplicated, exported, saved, imported, or started. The template store must fail loudly with `invalid_macro_template`; it must not skip, migrate, quarantine, normalize, rewrite, or silently ignore invalid documents.

## Editor Surfaces

The visual editor renders every recursive body with one stable, clear depth color from a fixed cyan-blue/teal/orange/rose palette. Purple is not part of the depth palette, and the former final cyan is omitted because it is too close to the first cyan-blue at deep nesting levels. A body's vertical guide, each direct node's left border, and bottom branch are continuous 2px solid lines using the same depth color. The guide and node border share the exact horizontal coordinate, so two indentation depths produce two lines rather than separate guide/accent pairs. The node border is moved onto the guide with compensated inner padding, preserving content alignment. The bottom branch uses a horizontal mask that begins fading after 18% and reaches transparent at 52%; it never uses a dash/gap pattern. Nodes render no top branch or neutral top border. If/elif/else wrappers are flat branch sections, not tree depths: they have no border, left padding, margin-left, or background rail. A compact keyword badge and at least 10px vertical spacing distinguish branches, while each branch's recursive action body provides the sole formal indent. An if body guide and a for body guide at the same semantic depth must share the same horizontal coordinate. Consecutive sibling nodes use at least 14px whitespace and no sibling-only divider.

`Flow V2 Body` is the only persistent body heading. Recursive bodies render as non-interactive `div` containers and never expose `Root body`, `for body`, `if body`, `elif body`, `else body`, or control `action body` summaries; those labels remain internal insertion context only. Bodies themselves cannot collapse. Every ordinary Flow node uses its numbered title row as the single chrome. Its right side contains one shared action bar with exactly six independent 24px icon-only buttons in this fixed order: Collapse/Expand, Move up, Move down, Add before, Add after, Remove. Collapse is always leftmost and Remove always rightmost; the bar is never split into structural and text groups. All six controls use 15px round-stroke inline SVG, zero button padding, native hover titles, and accessible names. Character glyph arrows, text action labels, and segmented container chrome are not used; each icon uses the same white background, neutral border, 4px radius, disabled shell, and blue-tint active language as other Macro buttons. The title and status badge occupy a separate left grid column, so showing `Collapsed` cannot move the right action bar. Collapsed nodes show that badge, an active toggle, and a depth-color-tinted compact card instead of relying only on chevron direction or a subtle gray background. Parallel lane actions reuse the same six-control component, order, geometry, numbered title, tooltips, and local collapse behavior. The required final Parallel Output keeps its specialized non-movable action.

Generic item operations use the same icon language. Message parts, text-list items, extract filters, and ELIF/ELSE branches render bare Up, Down, and Remove actions as 24px icon-only buttons with 15px rendered round-stroke SVG, zero padding, hover titles, accessible names, and normal disabled/focus states. Remove uses the shared 24-viewBox Lucide Trash2 outline rather than a cramped custom bin. These controls never display visible `Up`, `Down`, or `Remove` labels. Semantic actions remain textual: Add Text, Add Source, Add inside, Add elif, Add else, Add item, Add filter, Add lane, Remove lane, Add before output, and template-level commands expose their concrete object or outcome and must not be reduced to context-free icons.

IF-family structural actions belong to each branch title row. The left label cluster contains the IF, ELIF, or ELSE keyword badge and, only while folded, the same `Collapsed` badge used by nodes and Parallel actions. The right contextual action group always starts with that branch's Collapse/Expand icon and then shows Add/Remove actions; the collapse control is never placed beside the keyword. A two-column `minmax(0, 1fr) auto` title layout keeps the right action coordinates stable when the badge appears. Collapsing a branch hides only that branch's condition and recursive body; its keyword and complete contextual action group stay visible, and sibling branches are unaffected. The toggle reuses the shared blue-tint active style; branches do not define a separate solid-blue collapse language. Collapse state is editor-local, follows ELIF index shifts and IF node-id edits, and never adds template fields. IF shows Add elif and, only while no ELSE exists, Add else; IF is never removable. Every ELIF shows Add elif, the same conditional Add else, and Remove. Contextual Add elif inserts immediately after the clicked branch rather than appending globally. ELSE is terminal and shows only Remove. Adding the unique ELSE hides Add else from IF and every ELIF; removing ELSE restores all of them. ELIF/ELSE removal confirms before deleting the branch and its body. This editor behavior does not add or change template schema fields.

Macro chrome reserves vertical space for content without shrinking its core typography. In the default idle state, runner status, Start/Pause/Stop, and Debug share one row; Editor/JSON/Trace and Start/Pause/Stop are 28px high, while editor-local actions are at least 24px and use 12px text. The Macro template header is 39px with a 26px Reset width action. Prompt and Trace use coordinated 38px headers, 14px titles, 13px panel text, 12px actions, and 8px/6px section padding/gap; Trace view tabs are 28px. Section titles, field labels, node titles, textarea content/gutter, and JSON code text are 14px, 12px, 13px, 13px, and 14px respectively. Debug Refresh floats instead of expanding the dock. A runtime waiting-input prompt remains a full-width second row. Terminal/Text document font sizes are not reduced.

Every empty recursive flow body renders exactly one generic `Add inside` placeholder. There are no separate `Add inside if/elif/else/for` buttons and no control-node `Add action` duplicate. Once a body has a child, further insertion uses that child's normal Add before/Add after controls; ordinary action controls are unchanged, while IF-family structural actions remain on their branch label rows. Empty finish/break/continue action bodies use the same placeholder with an action-only palette. Parallel lane Add before/Add after triggers use the same full-screen insertion overlay, scrim, palette styles, anchored/center setting, viewport clamp, initial focus, Escape, and focus restore as the main flow insertion palette; Parallel has no private popup width, grid, shadow, or inline layout.

The JSON view is read-only by default. Edit creates an isolated text buffer and never mutates the visual draft while typing. Save must parse JSON, validate the complete current schema against the live config, preserve the selected template `id` and current `configId`, and then succeed at the normal server save before replacing the draft. Parse, schema, identity, or server failure keeps the buffer and edit mode unchanged. Cancel discards the buffer without a request.

While JSON edit mode is active, Editor/Trace switching, template replacement/mutation/export, and Runner Start are locked until Save or Cancel. Controls for an already-live run remain usable. JSON editing does not add migration, aliases, field normalization, or a second schema.

## Action Types

Flow V2 supports these action nodes:

- `send`
- `input`
- `wait`
- `capture-source`
- `extract_text`
- `parallel`
- `notify`

Flow V2 controls:

- `if` / `elif` / `else`
- `for`
- `break`
- `continue`
- `finish`

## Message Flow

`send` writes rendered message text to a target tab. It stores two required, orthogonal fields: `delivery: "auto" | "direct" | "bracketed-paste"` controls how the resolved body is framed, while `ending: "none" | "lf" | "cr" | "crlf"` controls only the raw suffix. New UI nodes explicitly default to `delivery: "auto"` and `ending: "cr"`.

`send.message.parts` is an ordered list. It may be empty. Each part is literal text, scoped template text, or a source artifact reference. Literal `{ "kind": "text", "text": string }` never interpolates braces. Scoped `{ "kind": "template", "template": string }` is valid only under a lexical text-list binding and replaces exact `{{index}}`, `{{key}}`, and `{{value}}` tokens in one scan; inserted key/value text, artifacts, and rendered output are never scanned recursively. An artifact part with no `source` means `none` and contributes an empty string. The runner concatenates parts in order without implicit separators or trimming; newlines and surrounding whitespace are user content.

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
  "delivery": "auto",
  "ending": "cr"
}
```

`input` pauses for user text. Its `prompt` may be a literal string or scoped template scalar; it also stores `allowEmpty`, the same required `delivery` and `ending`, and optional single `defaultSource`. If `defaultSource` is present, the runner pre-fills the runtime textarea with that artifact text; the user can edit it. The final textarea content is raw user content, is not trimmed, and is never template-expanded. `allowEmpty = false` rejects only zero-length input.

The editor exposes the same two selects on normal `send`, `input`, and parallel-lane `send`:

- `Input delivery`: Auto (recommended), Direct bytes, or Bracketed paste.
- `Ending sequence`: None, CR (`\r`), LF (`\n`), or CRLF (`\r\n`).

Auto resolves from the target's current tab capability at the actual write: Shell tabs (`fake` or `real`) use Bracketed paste and Text tabs use Direct bytes. Runtime input therefore resolves when submitted, including after the same terminal has been reset to another backend while input was waiting. Auto does not inspect the foreground process, track DEC mode 2004, scan content, or fall back at runtime. Direct bytes and Bracketed paste are manual overrides and remain selected regardless of target changes.

Resolved Direct delivery writes `content + suffix(ending)`. Resolved Bracketed paste writes `ESC[200~ + content + ESC[201~ + suffix(ending)`; the ending is outside the paste end marker, and the runner performs one logical terminal input dispatch. The exact ending mapping remains `none -> ""`, `lf -> "\n"`, `cr -> "\r"`, and `crlf -> "\r\n"`. Ending has no Auto option. Raw CR is a byte, not a universal keyboard Enter event.

When the resolved delivery is Bracketed paste, resolved content containing the exact end marker `ESC[201~` is rejected before any terminal write. This includes Auto targeting Shell. Auto targeting Text resolves Direct and permits the marker unchanged; explicit Bracketed paste targeting Text remains a manual override and performs the same collision check and framing. The marker is not escaped, split, deleted, or silently sent as Direct. Normal send pauses at the incomplete invocation, runtime input pauses and waits for new text after resume without replaying the rejected text, and parallel send follows its parent `onLaneFail` policy. No terminal content/write artifact or `terminal_text_sent` success event is produced for the rejected attempt.

`delivery` and `ending` must both be own enumerable fields with exact current values. Missing delivery is not interpreted as Auto. Missing, inherited, non-enumerable, unknown, alias, or old `enter` shapes are invalid and are never defaulted, migrated, or rewritten.

Template JSON must not mutate `message` or user input to include framing or ending bytes. Current `terminal_text_sent` events record requested `delivery`, actual `resolvedDelivery: "direct" | "bracketed-paste"`, and `ending`, plus the resolved pre-framing `content.artifactRef` and exact backend-bound `write.artifactRef`. Explicit delivery records the same value in both delivery fields. Auto Text writes contain no added Bracketed-paste markers; Text tabs retain their own display normalization of CR/CRLF to LF while the runner write evidence remains exact.

## Scoped Text Templates

A text-list loop binds a pure one-based decimal `index`, a user-editable single-line `key`, and a multiline `value`. The only token grammar is exact `{{index}}`, `{{key}}`, and `{{value}}`; `{{text}}`, expressions, whitespace variants, paths, filters, escaping rules, and outer-binding access are invalid. A template must contain at least one supported exact token and may repeat or mix them. Plain literal fields never interpolate braces.

Template-capable content is deliberately limited to six UI surfaces: normal send message text parts, parallel-lane send message text parts, notify title, notify message text parts, input prompt, and user-continue wait prompt. Condition/filter/extract text, ids and metadata, text-list items, control reasons, terminal/artifact/profile selectors, parallel labels, and merge separators remain literal/non-template fields.

Text-list scope is lexical. If/elif/else, control-terminal action bodies, inner count/forever loops, and parallel lane bodies inherit the complete current binding. An inner text-list shadows all three values and leaving that body restores the outer binding. A template outside any text-list scope is invalid for save/import/start; moving an existing template out of scope preserves its type and text so the editor can show an inline error and let the user explicitly turn template mode off. The editor exposes default-off `Use loop template` per field/part with three Insert controls. Each item card shows a read-only pure numeric index, a single-line Key, and an independent multiline Value; index is not persisted, while key/value order, duplicates, Unicode, newlines in Value, and surrounding whitespace are preserved.

Macro multiline content editors auto-size to the current visual `scrollHeight` plus one line until their surface-specific row cap, then use internal vertical scrolling. Native vertical resize may temporarily enlarge an editor up to `60vh`; that manual height survives content edits within the mounted component but is never stored in template JSON, run state, server state, or localStorage and resets on remount/reload. Message parts, text-list Value, input/user-continue prompts, template description, and runtime input use this shared behavior; single-line title/key/config fields, Prompt Library body, and terminal TextBoxSlot do not.

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

Runner HTTP actions use `POST /api/configs/<configId>/runner/<action>` with these exact JSON bodies:

- `start`: `{ "templateId": nonEmptyString }`
- `pause`: `{}`
- `resume`: `{}`
- `stop`: `{}`
- `input`: `{ "text": string }`

Each body must be a JSON object with exactly the listed fields. A zero-byte empty HTTP body is interpreted as `{}`, so it is valid only for pause/resume/stop; a whitespace-only body is malformed JSON. Malformed JSON, arrays, `null`, scalars, missing or invalid required fields, and unknown fields return HTTP 422 before service dispatch and do not change run state or cursor. Unknown fields take precedence over missing required fields. Request errors use `{ "ok": false, "error": string }` with `runner_request_missing_field:<action>:<field>`, `runner_request_invalid_field:<action>:<field>`, or `runner_request_unknown_field:<action>:<field>`; a non-object body uses field `body`. Runtime state and live-run conflicts return HTTP 409. Empty input text passes request validation and is accepted or rejected by the waiting input node's `allowEmpty`; resume position is always owned by the server occurrence cursor.

`for.range` supports three modes:

- count: exactly `{ "kind": "count", "count": positiveInt }`.
- forever: `{ "kind": "forever" }`; it runs until `break`, `finish`, stop, or fail, and must not store `count`.
- text-list: `{ "kind": "text-list", "items": Array<{ "key": string, "value": string }> }`; `items` must be non-empty and every item must contain exactly `key` and `value`. Key may be empty or repeated but cannot contain CR/LF; Value may be empty, repeated, or multiline.

Each range object accepts only the fields shown for its variant. A missing or unknown discriminator, an additional field, or a text-list item with any other shape fails current-schema validation.

Normal in-process pause/resume uses an occurrence-aware execution cursor rather than a static completed-step set. Sequence position, selected if branch, loop iteration/binding, parallel lane position, wait/input/capture suspension state, and occurrence-aware artifacts resume at the same dynamic invocation. Static step completion remains a UI/log summary only. Cursor snapshots are JSON-serializable, but server restart still leaves an in-flight run interrupted rather than hydrating and resuming it.

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

## Notify

`notify` emits a macro notification without writing to a terminal. Its title is a literal/template scalar and its `message.parts` use the same ordered literal/template/artifact semantics as `send`. Title and message must both render successfully before any channel delivery begins. Supported levels are `info`, `success`, `warning`, and `error`. Supported channels are `app`, `system`, and `telegram`.

`app` is shell-deck's built-in floating notification with optional sound (`none | bell | chime | ping | pulse | success | warning | alert`); new UI nodes default to `success`. It renders as one floating notice; the user can close it with Dismiss or by clicking outside the notice, and that outside click is consumed before normal workspace interaction. A newer app notification replaces the current one. App sound volume is a browser-global Settings preference up to 1000% and is not stored in macro JSON. `system` is a browser Notification API notification; the browser asks for permission when needed and reports denied/unavailable state in the app floating notice. `telegram` references a local profile by `profileId`; macro template JSON must not contain bot tokens or channel ids. Runtime Telegram profiles live in ignored local config at `.shell-deck/notification-profiles.json`; the tracked example is `config/notification-profiles.example.json`. The Macro editor renders Telegram profile ids as a select populated from the local runtime config; it does not expose token or channel id fields. App floating notices and Telegram messages include notification time, notification id, run id, and step id metadata.

`notify.onFailure` is `continue | pause | fail`. It applies to server-side delivery failures such as missing Telegram profile or Telegram HTTP failure. If a failure pauses the run after another channel succeeded, normal resume retries only undelivered/failed channels; it must not rebroadcast the browser notification or redeliver a successful Telegram profile. Browser-local permission denial for `system` is not a runner failure. Notify is not a parallel lane action in V0; put it after parent `parallel` fan-in when merged output is needed.
