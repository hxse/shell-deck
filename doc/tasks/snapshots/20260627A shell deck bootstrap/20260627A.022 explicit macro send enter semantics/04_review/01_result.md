# Result

## Summary

* Added `.022` task docs and index entry on the current jj change.
* Replaced Flow V2 current action names with `send` / `input`; `send_line` / `input_line` remain only as forbidden legacy names.
* Added required `enter: boolean` to `send` and `input`; UI defaults new root and parallel send/input nodes to `enter: true`.
* Runner now writes exact macro payload as `content + (enter ? "\n" : "")`; it no longer appends CR.
* `terminal_text_sent` records nested `content` and `write` artifacts plus `enter` and `enterSequence`.
* Synced active macro template spec and updated run log demo/replay coverage to the new event shape.

## Review

* P1: none.
* P2: none.
* P3: none.

## Notes

* Old action names are invalid rather than migrated, quarantined, skipped, or silently ignored.
* Template content remains raw content; submit LF is runtime evidence only.
