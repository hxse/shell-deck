# Review Result

Status: implementation-landed; automated gate passed.

## Summary

Implemented the .018 parallel lane tab redesign. Flow V2 now uses `parallel` instead of `parallel_send_capture`. Each lane has a restricted sequential body and a mandatory fixed final `output` node. The output node is not a root action, is not inserted from the normal palette, and is validated as the final lane node. Parent `parallel` produces `merged_text` for downstream actions. Lane terminals are unique within a parent `parallel`, occupied terminal choices are disabled in the editor, and `onLaneFail` is editable as `pause` or `fail`.

## Landed Scope

- Schema/types: `ParallelNode`, `ParallelLane`, `ParallelLaneOutputNode`, `ParallelOutputSource`.
- Validator: requires final Output, rejects missing/misordered Output, rejects duplicate lane ids/labels, rejects lane-local flow/input/nested parallel, validates lane-local output artifact scope.
- Runner: executes lanes concurrently, runs each lane body in order, reads lane Output, and writes parent `merged_text`.
- UI: added `ParallelLaneTabs.svelte` with lane tabs, add/remove lane, guarded id/label edits, lane action add/edit controls for send/wait/capture/extract, and a fixed Output card.
- Tests: updated unit/integration/e2e coverage and added `just test-018`.

## Known Notes

Historical run log event kinds for old `parallel_send_capture` remain in the enum so old logs can still be read. New runs emit `parallel_started`, `parallel_lane_started`, `parallel_lane_completed`, and `parallel_joined`.
