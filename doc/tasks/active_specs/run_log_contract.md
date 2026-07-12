# Run Log Contract

## Truth Model

Macro run state is reconstructed from one append-only event log plus artifacts. UI node logs and AI-readable traces derive from the same event log; there is no second truth source.

Each event has a monotonic `eventSeq` within a run and a server-generated event id. Run-scoped events omit `stepId`; step-scoped operational events include `stepId`.

Dynamic occurrences are identified by optional structured `data.executionPath` segments: `{ kind: "for", stepId, iterationIndex }` and `{ kind: "parallel-lane", stepId, laneId }`. New `loop_iteration_started` / `loop_iteration_completed` events record zero-based `iterationIndex`, one-based `iteration`, `rangeKind`, and a finite `total` or `null` for forever. Text-list execution does not add independent `index` / `key` / `value` binding snapshot fields to JSONL; existing action events may still record their user-visible rendered title, prompt, or summary under the action's normal evidence contract. When `data.nextStepId` or `data.nextExecutionPath` is present, schema validation strictly checks the public step id or every structured path segment; `nextStepId: null` denotes no next invocation. Old events without occurrence or next-pointer fields remain valid legacy static occurrences; replay must not fabricate a resumable cursor from them.

## Artifacts

Large or structured payloads are written as artifacts before the event that references them. Artifact refs are server-generated and path-checked under the run artifact directory.

Current `terminal_text_sent` events record the required Macro `ending` value (`none | lf | cr | crlf`), a `content` artifact before the ending is appended, and an exact `write` artifact containing the backend-bound payload. This write artifact, rather than fake/text terminal display behavior, is the evidence for CR/LF bytes. Existing append-only events may contain older free-form data fields; replay does not rewrite or synthesize current ending evidence for them.

Runtime artifact resolution is occurrence-aware even though template references keep a static producer `stepId`: it first looks for the producer in the current iteration/lane context and may then inherit a visible outer predecessor. It must not read a sibling lane, future occurrence, previous iteration's local producer, or a later lexical scope.

Missing artifact refs are recoverable replay errors and must be visible in derived node logs.

## Recovery

Replay validates event ordering, duplicate event ids, malformed JSON, trailing half-lines, and missing artifacts. Recoverable replay errors preserve the parsed prefix and report the problem.

Within one live `MacroRunnerService` runtime, normal pause/resume continues from the saved dynamic occurrence. Duration and terminal-quiet waits preserve active-time budgets; user-continue and input complete their original invocation; if branches are not re-evaluated; loops and parallel lanes continue their own sequence cursor; AgentEvent capture and partial notification delivery preserve their sub-state. Static completed `stepId` data is only a derived UI summary and never controls dynamic continuation.

A user-requested pause or stop is published only after the active operation reaches a safe boundary. A terminal, notification, or claimed input side effect that already started finishes and appends its outcome and `step_completed` first. Claimed input uses a checkpoint drain to finish only its already-started invocation bookkeeping and advance the next pointer before a pending transition is published. `run_paused` records `nextStepId` and `nextExecutionPath`; `run_resumed` records `nextStepId` and the resumed `executionPath`.

At the boundary, stop has priority: even when the active side effect was the last action, its outcome is recorded first and `run_stopped` then wins over natural `run_completed`. Pause does not have that priority; when a finish control or last action has completed and there is no next invocation, natural completion may win and no synthetic `run_paused` is emitted.

This is in-process continuation, not durable restart hydration. After server/runtime loss, an in-flight run remains `interrupted`; event replay does not reconstruct the interpreter. V0 also does not fully resolve the crash window where terminal input or another external effect succeeded before its event/checkpoint was appended, so it does not promise crash-safe exactly-once delivery.

## Node Logs

Node logs group events by static macro step for navigation. Repeated dynamic occurrences of the same step are distinguished by their event `executionPath`. `parallel` lane events include `laneId` metadata and remain grouped under the parent `parallel` step. The merged output is represented by a `merged_text` artifact ref on the parent step.

## Real-Time UI Updates

RunEventStore append is the single notification source. After any event append succeeds, the server broadcasts `run_log_updated` with `configId`, `runId`, `eventSeq`, and `kind`. UI views use this signal to refresh the selected run and run list. Manual refresh is a debug/recovery path, not the normal way to observe run progress.
