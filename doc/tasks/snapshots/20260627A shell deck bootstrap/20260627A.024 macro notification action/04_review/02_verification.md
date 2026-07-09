# Verification

## Commands

* `just test-024` - PASS. 30 Bun tests, 118 expect calls; 5 Playwright tests passed. Vite emitted the existing non-blocking chunk-size warning: `Some chunks are larger than 500 kB after minification`.
* `just check` - PASS. `svelte-check` found 0 errors and 0 warnings.
* Targeted Settings migration Playwright coverage - PASS. 5 Playwright tests passed across `macroNodeInsertion` and `terminalDeck.ui`.
* Targeted MacroTemplate popover and notify default coverage - PASS. 3 Playwright tests passed across `macroNodeInsertion` and `macroTemplateWorkbench`; 11 Playwright tests passed across notify, workspace, capture, parallel, runner, tab capability, and real shell GUI flows.
* `just test-unit` - PASS. 156 tests, 657 expect calls.
* `git diff --check` - PASS.

## Coverage

* Schema coverage accepts valid notify nodes with selectable app sounds and rejects invalid level/title/channels/sound/onFailure.
* Schema coverage rejects Telegram secret fields in macro JSON.
* Notification service coverage verifies runtime config path, fieldized Telegram payload shape including metadata, default link preview suppression, missing profile behavior, truncation, profile id listing, and no token/channel id leakage in results.
* HTTP integration coverage verifies the Telegram profile list API returns profile ids only and degrades invalid local config to an empty non-secret catalog.
* Runner integration covers browser app/system WebSocket broadcast metadata, server-side Telegram dispatch metadata through a mock dispatcher, sanitized Telegram transport failures in run events, notification run events, and pause-on-failure behavior.
* Playwright coverage verifies notify insertion/editor controls use a select for Telegram profile, app-channel floating notice replacement/outside-click dismiss metadata, app toast delivery while system permission is still pending, non-fatal Telegram profile load failure, and browser system permission request fallback during real macro runs.
* Settings popover exposes browser-local Insert placement, notification volume default and 1000% max, outside-click close, and tab Drag controls.

## Residual Warnings

* Vite build warns that some chunks are larger than 500 kB after minification during Playwright web-server builds. This is an existing bundle-size warning and is not blocking .024 notification behavior.
