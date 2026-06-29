# Macro Template Contract

## Template Storage

Macro templates are JSON documents stored per config. Templates can be created, saved, duplicated, deleted, imported, and exported. Imports migrate old `terminalAliases` and top-level `captureSources` into the current schema.

Templates do not store Codex session ids. Templates refer to terminals by structured refs: index, id, or alias.

## Step Types

V0 supports:

- `send_line`
- `sleep`
- `input_line`
- `wait`
- `capture-source`
- `parse`
- `branch`
- `goto`
- `pause`
- `complete`
- `fail`
- `stop`
- `parallel_all`

`send_line` writes text to a target terminal and sends Enter. It does not distinguish prompts from shell commands.

## Wait Modes

- `duration`: fixed wait.
- `terminal-quiet`: waits until a terminal has no output for `quietMs`, up to `maxMs`.
- `capture-ready-or-user`: waits until the selected capture source is ready or user continues.
- `user-continue`: pauses until the user resumes.

## Branch Conditions

Branch conditions are structured JSON, never string expressions:

```json
{ "signal": "onlyP3OrClean", "op": "==", "value": true, "goto": "done" }
```

Signals must be declared by the selected parser profile or regex rule. Comparisons are typed; V0 does not treat `"true" == true` as valid.

## Runner Semantics

A config can have at most one live macro run. Live includes running, paused, waiting, waiting for input, or interrupted. Starting a second live run in the same config is rejected. Another config may run independently.

`input_line` is an explicit macro input tool: it pauses, waits for user text, sends that text to the target terminal with Enter, then continues.

Looping is supported through `goto` with `loopGuard.maxIterations`. General `for_each`, dynamic item binding, `break`, and `continue` are deferred.

## Parallel All

`parallel_all` is the only V0 bounded parallel primitive. It runs static lanes inside one macro run. Each lane must use a different primary terminal and can contain only linear lane steps: `send_line`, `sleep`, `wait`, `capture-source`, `parse`.

Lane capture/parser reuse the normal capture and parser adapters. Lane success uses structured typed conditions. `all_success` join moves to the parent next step. Lane failure pauses or fails the whole run according to template config.

The visual editor supports lane id/terminal editing. Advanced lane internals are configured through JSON preview/import/export in V0.
