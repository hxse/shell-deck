# Capture And AgentEvent Contract

## Capture Sources

V0 capture source steps are explicit template steps:

```json
{ "type": "capture-source", "capture": { "kind": "terminal-buffer", "terminal": { "kind": "alias", "value": "reviewer" }, "mode": "scrollback-tail", "maxChars": 12000 } }
```

Supported capture kinds:

- `terminal-buffer`: tails terminal replay, writes raw and normalized artifacts.
- `agent-event`: selects a matching AgentEvent, writes raw event and captured text artifacts.

## Terminal Buffer

Terminal-buffer capture normalizes ANSI/control sequences and line endings into deterministic parser input. Raw and normalized artifacts are both traceable.

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
