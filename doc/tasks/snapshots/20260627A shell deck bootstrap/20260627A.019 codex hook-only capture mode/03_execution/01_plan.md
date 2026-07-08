# Execution Plan

## Phase 1: Wrapper And Probe

* Ensure `just -f ... codex` runs Codex in the invocation directory.
* Ensure hook env includes `SHELL_DECK_DATA_ROOT` pointing at shell-deck root unless explicitly overridden.
* Register `UserPromptSubmit` alongside `SessionStart` and `Stop`.
* Extend `.001` offline probe to assert hook config and data-root propagation.

Gate:

* `bun test tests/001-offline.test.ts`

## Phase 2: AgentEvent Protocol

* Add `agent.prompt_submitted` event kind.
* Add `codex-user-prompt-submit-hook` adapter.
* Normalize `UserPromptSubmit.prompt` to `capturedText`.
* Validate prompt/output adapters separately.

Gate:

* `bun test tests/unit/codexHookAdapter.test.ts tests/unit/agentEventIngest.test.ts`

## Phase 3: Macro Capture Contract

* Add required `captureMode` to `agent-event` capture config.
* Delete `eventKind` / `field` from Flow V2 macro schema.
* UI exposes only Agent and Mode.
* Update active specs.

Gate:

* `bun test tests/unit/flowV2Schema.test.ts`

## Phase 4: Runner

* `result_only`: wait for next post-baseline `agent.output`.
* `prompt_only`: wait for next post-baseline `agent.prompt_submitted`.
* `prompt_and_result`: wait for matching `agentSessionId + agentTurnId` prompt/output pair.
* Preserve consumed-event tracking and artifact trace.

Gate:

* `bun test tests/integration/agentEventCapture.test.ts`

## Phase 5: Close Gate

* Add `test:019` package script and `just test-019` recipe.
* Run automated gate and record verification.
