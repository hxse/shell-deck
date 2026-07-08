# Capture And AgentEvent Contract

## Capture Sources

V0 capture source steps are explicit template steps:

```json
{ "type": "capture-source", "capture": { "kind": "terminal-buffer", "terminal": { "kind": "alias", "value": "reviewer" }, "mode": "scrollback-tail", "maxChars": 12000 } }
```

Supported capture kinds:

- `terminal-buffer`: tails terminal replay, writes raw and normalized artifacts. `scrollback-tail` sets `captured_text` to normalized visible screen text; `raw-stream-tail` sets `captured_text` to the raw stream tail.
- `text-box`: reads a `backend = text` deck slot as plain text and writes a captured text artifact.
- `agent-event`: selects matching Codex hook AgentEvents after the macro run-start baseline, writes raw event and captured text artifacts. It only consumes fields provided directly by Codex hooks; V0 does not read transcripts, TUI output, `codex exec --json`, reasoning, tool calls, or intermediate steps. It must not consume historical matching events from before the current run. If no new matching event has arrived yet, the capture step waits for one instead of fabricating or reusing stale text.

AgentEvent capture requires `captureMode`:

- `result_only`: captures the next `Stop.last_assistant_message` as `captured_text`.
- `prompt_only`: captures the next `UserPromptSubmit.prompt` as `captured_text`.
- `prompt_and_result`: waits for `UserPromptSubmit.prompt` and `Stop.last_assistant_message` with the same `agentSessionId` and the same `agentTurnId`, then writes sectioned text containing both.

## Terminal Buffer

Terminal-buffer `scrollback-tail` renders visible terminal text instead of treating every carriage return as a newline. Raw and normalized artifacts are both traceable; `raw-stream-tail` is available when the user explicitly wants the raw PTY stream.

## AgentEvent Protocol

Codex hooks and future agent adapters normalize callbacks into AgentEvent records. AgentEvents are config scoped and terminal scoped.

AgentEvent fields include:

- `agentKind`
- `eventKind`
- `configId`
- `terminalId`
- `launchId`
- `agentSessionId`
- `agentTurnId` for `agent.prompt_submitted` and `agent.output`
- adapter metadata such as `codexSessionId`
- `capturedText`
- raw source payload

Example:

```json
{ "type": "capture-source", "capture": { "kind": "agent-event", "agent": { "kind": "codex" }, "terminal": { "kind": "alias", "value": "reviewer" }, "captureMode": "prompt_and_result" } }
```

Codex `SessionStart`, `UserPromptSubmit`, and `Stop` hooks are the supported adapter path. `SessionStart` records session metadata for tracing. `UserPromptSubmit.prompt` records the submitted prompt. `Stop.last_assistant_message` records the final assistant result. Codex session ids are recorded for debugging and future work, not used as V0 macro identity.

## Ingest And Spool

When local HTTP ingest is available, hooks can POST to `/api/agent-events`. Offline hook fallback writes atomically published JSONL spool files; server import folds spool into the append-only AgentEvent store.
