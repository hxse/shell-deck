# Capture And AgentEvent Contract

## Capture Sources

V0 capture source steps are explicit template steps:

```json
{ "type": "capture-source", "capture": { "kind": "terminal-buffer", "terminal": { "kind": "alias", "value": "reviewer" }, "mode": "scrollback-tail", "maxChars": 12000 } }
```

Supported capture kinds:

- `terminal-buffer`: tails terminal replay, writes raw and normalized artifacts. `scrollback-tail` sets `captured_text` to normalized visible screen text; `raw-stream-tail` sets `captured_text` to the raw stream tail.
- `text-box`: reads a `backend = text` deck slot as plain text and writes a captured text artifact.
- `agent-event`: selects a matching AgentEvent, writes raw event and captured text artifacts.

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
- optional `agentSessionId` / `agentTurnId`
- adapter metadata such as `codexSessionId`
- `capturedText`
- raw source payload

Codex `SessionStart` and `Stop` hooks are the first supported adapter path. Codex session ids are recorded for debugging and future work, not used as V0 macro identity.

## Ingest And Spool

When local HTTP ingest is available, hooks can POST to `/api/agent-events`. Offline hook fallback writes atomically published JSONL spool files; server import folds spool into the append-only AgentEvent store.
