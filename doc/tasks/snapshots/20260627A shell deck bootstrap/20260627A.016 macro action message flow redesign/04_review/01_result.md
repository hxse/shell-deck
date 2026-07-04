# Review Result

Status: implementation-landed; automated gate passed

## Summary

`.016` is now implemented on top of the `.015` component boundary split. The macro language path is hard-cut to Flow V2 for new/imported templates and the old Flow V1 `steps`/`next`/`parse`/`branch`/`sleep`/`parallel_all` path is no longer a supported import/edit/run surface.

The landed implementation keeps `.014/.015` workbench chrome intact and changes the macro language/runtime/editor layer only.

## Landed Scope

* Flow V2 schema/template store now use `schemaVersion: 2` with `body`; invalid template files/imports fail loudly with `invalid_macro_template` in read/list/import paths.
* Actions are reduced to `send_line`, `input_line`, `wait`, `capture-source`, `extract_text`, and `parallel_send_capture`.
* `send_line` uses ordered text/source parts and can append rendered text to `backend = text` deck slots; `input_line` uses prompt plus optional defaultSource for runtime user editing.
* `parse` and built-in `ai-json` macro actions are removed from the Flow V2 language. Text checks live in structured `if.text_match` conditions using simple or regex matching; text extraction lives in deterministic `extract_text` and produces `extracted_text`.
* `wait` supports `duration`, `terminal-quiet`, and `user-continue`; `capture-ready-or-user` and `sleep` are removed from the new language.
* `capture-source` supports terminal-buffer, text-box, and explicit codex AgentEvent source configuration; terminal-buffer defaults to visible screen text via `scrollback-tail` and also supports `raw-stream-tail` for raw PTY forwarding; text-box reads `backend = text` deck slots as plain text.
* `parallel_send_capture` replaces `parallel_all`: it fans out ordinary send/wait/capture items, joins all items, and emits one `merged_text` artifact for downstream actions.
* `extract_text` supports split/filter/select/regex-group/trim/onEmpty and writes `text_extracted` run-log events for traceability.
* Runner events and e2e tests now use `parallel_send_capture_*` events and Flow V2 branch decisions.
* Macro editor controls were updated within the `.015` component boundaries; no workbench chrome/layout redesign was added in this task.

## Notes

Online Codex GUI smoke remains guarded by `SHELL_DECK_RUN_ONLINE=1`; the offline automated gate verifies the runnable Flow V2 path, and the online test file has been updated to Flow V2 templates for when the online gate is explicitly enabled.
