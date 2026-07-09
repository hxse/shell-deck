# Execution Plan

1. Add .024 task docs and active macro contract updates.
2. Add Flow V2 notify types and schema validation.
3. Add notification service with local profile loading and Telegram Bot API delivery.
4. Wire notify runner execution, run events, and WebSocket broadcast.
5. Add Macro editor controls for notify action.
6. Add frontend app toast, named app sounds, browser-local Settings, and browser system notification permission handling.
7. Add tracked example config plus just entrypoints for config init and explicit Telegram smoke.
8. Add focused offline tests and run close gate.

## Close Gate

* `just test-024`
* `just check`
* `just test-unit`
* `git diff --check`
