# Run Log Contract

## Truth Model

Macro run state is reconstructed from one append-only event log plus artifacts. UI node logs and AI-readable traces derive from the same event log; there is no second truth source.

Each event has a monotonic `eventSeq` within a run and a server-generated event id. Run-scoped events omit `stepId`; step-scoped operational events include `stepId`.

## Artifacts

Large or structured payloads are written as artifacts before the event that references them. Artifact refs are server-generated and path-checked under the run artifact directory.

Missing artifact refs are recoverable replay errors and must be visible in derived node logs.

## Recovery

Replay validates event ordering, duplicate event ids, malformed JSON, trailing half-lines, and missing artifacts. Recoverable replay errors preserve the parsed prefix and report the problem.

Normal pause/resume does not duplicate already event-logged terminal sends. V0 does not fully resolve the crash window where input reached a terminal before the corresponding event was written.

## Node Logs

Node logs group events by macro step. `parallel` lane events include `laneId` metadata and remain grouped under the parent `parallel` step. The merged output is represented by a `merged_text` artifact ref on the parent step.

## Real-Time UI Updates

RunEventStore append is the single notification source. After any event append succeeds, the server broadcasts `run_log_updated` with `configId`, `runId`, `eventSeq`, and `kind`. UI views use this signal to refresh the selected run and run list. Manual refresh is a debug/recovery path, not the normal way to observe run progress.
