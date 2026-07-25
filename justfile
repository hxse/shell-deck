set shell := ["bash", "-eu", "-o", "pipefail", "-c"]

default:
    just --list

# Build the production UI, then start the local-only shell-deck server.
start *args: build
    bun run server/httpServer.ts {{args}}

stop *args:
    bun run scripts/stop-server.ts {{args}}

# Vite serves the Svelte UI with HMR; Bun serves API and Room WebSocket traffic.
dev *args:
    bun run scripts/dev.ts {{args}}

check: file-size ui-style-residue check-ts check-svelte

file-size:
    bun run scripts/checkFileSize.ts

ui-style-residue:
    bun run scripts/checkUiStyleResidue.ts

check-ts:
    bun x tsc --noEmit

check-svelte:
    bun x svelte-check --config ./svelte.config.js --tsconfig ./tsconfig.json

build:
    bun run build

test-unit:
    bun run test:unit

test-integration:
    bun run test:integration

test-e2e:
    bun run test:e2e

test-032:
    bun run test:032

test-033:
    bun run test:033

test-034:
    bun run test:034

test-035:
    bun run test:035

test-037:
    bun run test:037

test-038:
    bun run test:038

test-039:
    bun run test:039

test-001:
    HISTFILE=/dev/null bun test tests/unit/macroDefinition034.core.test.ts tests/unit/macroDefinition034.action.test.ts tests/unit/macroDefinition034.control.test.ts tests/unit/runnerSnapshotMerge035.test.ts tests/unit/macroFlowVisualEditor006.test.ts tests/unit/workbenchThemeMigration003.test.ts tests/unit/currentTestJourneyInventory010.test.ts tests/unit/uiBehaviorInventory031B.test.ts
    bun run scripts/runPlaywright.ts --workers=1 tests/e2e/macroWorkbenchFixes001.spec.ts tests/e2e/comprehensiveMacroUiBehaviorCurrent.spec.ts tests/e2e/workbenchThemeMigration003.spec.ts tests/e2e/roomRuntimeSync035.takeover.spec.ts

test-002:
    HISTFILE=/dev/null bun test tests/unit/terminalParserWritePump.test.ts tests/unit/terminalViewState.test.ts
    bun run scripts/runPlaywright.ts --workers=1 tests/e2e/roomLargeReplay032.stream.spec.ts tests/e2e/roomLargeReplay032.retention.spec.ts tests/e2e/roomLargeReplay032.lifecycle.spec.ts

test-20260722b-001:
    bun run test:theme-foundation
    HISTFILE=/dev/null bun test tests/unit/browserSettings032.test.ts tests/unit/uiBehaviorInventory031B.test.ts
    bun run scripts/runPlaywright.ts --workers=1 tests/e2e/themeFoundation001.spec.ts tests/e2e/comprehensiveUiBehaviorCurrent.spec.ts tests/e2e/workbenchThemeMigration003.spec.ts

test-20260722b-002:
    HISTFILE=/dev/null bun test tests/unit/appRoomTerminalChrome002.test.ts tests/unit/themeFoundation001.test.ts tests/unit/terminalFont.test.ts tests/unit/uiBehaviorInventory031B.test.ts tests/unit/workbenchThemeMigration003.test.ts
    bun run scripts/runPlaywright.ts --workers=1 tests/e2e/appRoomTerminalChrome002.spec.ts tests/e2e/themeFoundation001.spec.ts tests/e2e/roomHome032.spec.ts tests/e2e/roomLargeReplay032.stream.spec.ts tests/e2e/roomLargeReplay032.retention.spec.ts tests/e2e/roomLargeReplay032.lifecycle.spec.ts tests/e2e/comprehensiveUiBehaviorCurrent.spec.ts tests/e2e/workbenchThemeMigration003.spec.ts --grep-invert "visited terminal views survive Shell and Text tab switches"

test-20260722b-002-chrome:
    bun run scripts/runPlaywright.ts --workers=1 tests/e2e/appRoomTerminalChrome002.spec.ts tests/e2e/workbenchThemeMigration003.spec.ts

test-20260722b-003:
    HISTFILE=/dev/null bun test tests/unit/uiStructureBaseline003.test.ts tests/unit/workbenchThemeMigration003.test.ts tests/unit/themeFoundation001.test.ts tests/unit/appRoomTerminalChrome002.test.ts tests/unit/uiBehaviorInventory031B.test.ts tests/unit/currentTestJourneyInventory010.test.ts tests/unit/macroFlowVisualEditor006.test.ts
    bun run scripts/runPlaywright.ts --workers=1 tests/e2e/workbenchThemeMigration003.spec.ts tests/e2e/macroWorkbenchFixes001.spec.ts tests/e2e/comprehensiveMacroUiBehaviorCurrent.spec.ts

test-20260722b-004:
    just ui-style-residue
    HISTFILE=/dev/null bun test tests/unit/uiThemeCloseout004.test.ts tests/unit/themeFoundation001.test.ts tests/unit/appRoomTerminalChrome002.test.ts tests/unit/workbenchThemeMigration003.test.ts tests/unit/terminalFont.test.ts tests/unit/uiBehaviorInventory031B.test.ts tests/unit/currentTestJourneyInventory010.test.ts
    bun run scripts/runPlaywright.ts --workers=1 tests/e2e/uiThemeCloseout004.spec.ts tests/e2e/themeFoundation001.spec.ts tests/e2e/appRoomTerminalChrome002.spec.ts tests/e2e/workbenchThemeMigration003.spec.ts

test-20260722c:
    just ui-style-residue
    HISTFILE=/dev/null bun test tests/unit/businessThemeContrastC.test.ts tests/unit/browserSettings032.test.ts tests/unit/themeFoundation001.test.ts tests/unit/uiThemeCloseout004.test.ts
    bun run scripts/runPlaywright.ts --workers=1 tests/e2e/businessThemeContrastC.spec.ts tests/e2e/themeFoundation001.spec.ts tests/e2e/appRoomTerminalChrome002.spec.ts

test-20260723a:
    just ui-style-residue
    HISTFILE=/dev/null bun test tests/unit/businessThemeContrastC.test.ts tests/unit/workbenchThemeMigration003.test.ts tests/unit/uiThemeCloseout004.test.ts
    bun run scripts/runPlaywright.ts --workers=1 tests/e2e/businessThemeContrastC.spec.ts tests/e2e/macroWorkbench034.layout.spec.ts

test-20260723b-001:
    HISTFILE=/dev/null bun test tests/unit/roomControl033.test.ts tests/unit/terminalRuntime032.test.ts tests/unit/terminalRoomManager032.test.ts tests/unit/terminalRoomDecomposition008.test.ts tests/unit/contentEditLease033.test.ts
    HISTFILE=/dev/null bun test tests/integration/roomRuntimeSync035.test.ts tests/integration/realRoomLifecycle032.test.ts tests/integration/realPtyInteraction032.test.ts tests/integration/macroRuntime034.prepare.test.ts tests/integration/macroRuntime034.terminal.test.ts tests/integration/agentEventWaitLimit038.test.ts
    bun run scripts/runPlaywright.ts --workers=1 tests/e2e/singleWriterRoom033.spec.ts tests/e2e/roomRuntimeSync035.takeover.spec.ts tests/e2e/roomHome032.spec.ts tests/e2e/roomLargeReplay032.stream.spec.ts tests/e2e/roomLargeReplay032.retention.spec.ts tests/e2e/roomLargeReplay032.lifecycle.spec.ts

test-20260723b-002:
    HISTFILE=/dev/null bun test tests/unit/macroInvalidationQueue004.test.ts tests/unit/macroDefinition034.core.test.ts tests/unit/macroDefinition034.action.test.ts tests/unit/macroDefinition034.control.test.ts tests/unit/contentEditLease033.test.ts
    HISTFILE=/dev/null bun test tests/integration/macroRuntime034.durability.test.ts tests/integration/contentEditLeaseProcess033.test.ts
    bun run scripts/runPlaywright.ts --workers=1 tests/e2e/roomRuntimeSync035.saved-content-save.spec.ts tests/e2e/roomRuntimeSync035.saved-content-create.spec.ts tests/e2e/roomRuntimeSync035.saved-content-reconnect.spec.ts tests/e2e/macroWorkbenchFixes001.spec.ts

test-20260723b-004:
    just ui-style-residue
    HISTFILE=/dev/null bun test tests/unit/macroFlowVisualEditor006.test.ts tests/unit/flowV2EditorCommands034.test.ts tests/unit/workbenchThemeMigration003.test.ts tests/unit/uiThemeCloseout004.test.ts tests/unit/businessThemeContrastC.test.ts
    bun run scripts/runPlaywright.ts --workers=1 tests/e2e/macroWorkbench034.flow.spec.ts tests/e2e/macroWorkbench034.layout.spec.ts tests/e2e/comprehensiveMacroUiBehaviorCurrent.spec.ts

test-20260723c-001:
    HISTFILE=/dev/null bun test tests/unit/evidenceStore032.test.ts
    HISTFILE=/dev/null bun test tests/unit/macroRunStore034.test.ts
    HISTFILE=/dev/null bun test tests/integration/macroRuntime034.durability.test.ts
    bun run scripts/runPlaywright.ts --workers=1 tests/e2e/comprehensiveMacroUiBehaviorCurrent.spec.ts

test-20260723c-002:
    HISTFILE=/dev/null bun test tests/unit/macroRunnerDecomposition002.test.ts
    HISTFILE=/dev/null bun test tests/unit/macroRunnerExecution007.test.ts
    HISTFILE=/dev/null bun test tests/unit/runnerSnapshotMerge035.test.ts
    HISTFILE=/dev/null bun test tests/integration/macroRuntime034.prepare.test.ts
    HISTFILE=/dev/null bun test tests/integration/macroRuntime034.execution.test.ts
    HISTFILE=/dev/null bun test tests/integration/macroRuntime034.lifecycle.test.ts
    HISTFILE=/dev/null bun test tests/integration/macroRuntime034.terminal.test.ts
    HISTFILE=/dev/null bun test tests/integration/macroRuntime034.durability.test.ts
    HISTFILE=/dev/null bun test tests/integration/roomRuntimeSync035.test.ts
    HISTFILE=/dev/null bun test tests/integration/agentEventWaitLimit038.test.ts
    bun run scripts/runPlaywright.ts --workers=1 tests/e2e/roomRuntimeSync035.runner.spec.ts tests/e2e/roomRuntimeSync035.runtime-input.spec.ts

test-20260723c-003:
    HISTFILE=/dev/null bun test tests/unit/contentEditLeaseStateStore003.test.ts
    HISTFILE=/dev/null bun test tests/unit/contentEditLease033.test.ts
    HISTFILE=/dev/null bun test tests/integration/contentEditLeaseProcess033.test.ts
    HISTFILE=/dev/null bun test tests/integration/singleWriter033.test.ts
    HISTFILE=/dev/null bun test tests/integration/macroRuntime034.durability.test.ts
    bun run scripts/runPlaywright.ts --workers=1 tests/e2e/roomRuntimeSync035.saved-content-save.spec.ts tests/e2e/roomRuntimeSync035.saved-content-create.spec.ts tests/e2e/roomRuntimeSync035.saved-content-reconnect.spec.ts

test-20260723c-004:
    HISTFILE=/dev/null bun test tests/unit/roomControlDecomposition004.test.ts
    HISTFILE=/dev/null bun test tests/unit/roomControl033.test.ts
    HISTFILE=/dev/null bun test tests/unit/contentEditLease033.test.ts
    HISTFILE=/dev/null bun test tests/unit/terminalRoomManager032.test.ts
    HISTFILE=/dev/null bun test tests/integration/terminalRoomWebSocket032.test.ts
    HISTFILE=/dev/null bun test tests/integration/singleWriter033.test.ts
    HISTFILE=/dev/null bun test tests/integration/roomRuntimeSync035.test.ts
    bun run scripts/runPlaywright.ts --workers=1 tests/e2e/singleWriterRoom033.spec.ts tests/e2e/roomRuntimeSync035.takeover.spec.ts

test-20260723c-005:
    HISTFILE=/dev/null bun test tests/unit/terminalBackendDecomposition005.test.ts
    HISTFILE=/dev/null bun test tests/unit/terminalRuntime032.test.ts
    HISTFILE=/dev/null bun test tests/unit/terminalRoomDecomposition008.test.ts
    HISTFILE=/dev/null bun test tests/unit/terminalRoomManager032.test.ts
    HISTFILE=/dev/null bun test tests/unit/realPtyBackend.test.ts
    HISTFILE=/dev/null bun test tests/integration/realRoomLifecycle032.test.ts
    HISTFILE=/dev/null bun test tests/integration/realPtyInteraction032.test.ts
    HISTFILE=/dev/null bun test tests/integration/realPtyOutputBatching.test.ts
    HISTFILE=/dev/null bun test tests/integration/realPtyResizeFlush.test.ts
    bun run scripts/runPlaywright.ts --workers=1 tests/e2e/roomLargeReplay032.lifecycle.spec.ts --grep "Room terminal reset"
    bun run scripts/runPlaywright.ts --workers=1 tests/e2e/roomHome032.spec.ts

test-20260723c-006:
    HISTFILE=/dev/null bun test tests/unit/roomRegistryDecomposition006.test.ts
    HISTFILE=/dev/null bun test tests/unit/terminalRoomManager032.test.ts
    HISTFILE=/dev/null bun test tests/unit/terminalRoomDecomposition008.test.ts
    HISTFILE=/dev/null bun test tests/unit/roomControl033.test.ts
    HISTFILE=/dev/null bun test tests/integration/roomRouting032.test.ts
    HISTFILE=/dev/null bun test tests/integration/realRoomLifecycle032.test.ts
    HISTFILE=/dev/null bun test tests/integration/terminalRoomWebSocket032.test.ts
    HISTFILE=/dev/null bun test tests/integration/macroRuntime034.lifecycle.test.ts
    bun run scripts/runPlaywright.ts --workers=1 tests/e2e/roomHome032.spec.ts

test-20260723c-007:
    HISTFILE=/dev/null bun test tests/unit/roomWorkspaceDecomposition007.test.ts
    HISTFILE=/dev/null bun test tests/unit/roomRevisionGate035.test.ts tests/unit/runnerSnapshotMerge035.test.ts tests/unit/terminalViewState.test.ts tests/unit/terminalRoomClient032.test.ts
    HISTFILE=/dev/null bun test tests/integration/terminalRoomWebSocket032.test.ts
    HISTFILE=/dev/null bun test tests/integration/roomRuntimeSync035.test.ts
    bun run scripts/runPlaywright.ts --workers=1 tests/e2e/singleWriterRoom033.spec.ts tests/e2e/roomRuntimeSync035.takeover.spec.ts tests/e2e/roomRuntimeSync035.runtime-input.spec.ts tests/e2e/comprehensiveUiBehaviorCurrent.spec.ts

test-20260723c-008:
    HISTFILE=/dev/null bun test tests/unit/macroInvalidationQueue004.test.ts
    HISTFILE=/dev/null bun test tests/unit/flowV2EditorCommands034.test.ts tests/unit/macroDefinition034.core.test.ts tests/unit/macroDefinition034.action.test.ts tests/unit/macroDefinition034.control.test.ts
    HISTFILE=/dev/null bun test tests/integration/macroRuntime034.durability.test.ts
    HISTFILE=/dev/null bun test tests/integration/contentEditLeaseProcess033.test.ts
    bun run scripts/runPlaywright.ts --workers=1 tests/e2e/macroWorkbench034.record.spec.ts tests/e2e/macroWorkbench034.feedback.spec.ts tests/e2e/macroWorkbench034.layout.spec.ts tests/e2e/roomRuntimeSync035.saved-content-save.spec.ts tests/e2e/roomRuntimeSync035.saved-content-create.spec.ts tests/e2e/roomRuntimeSync035.saved-content-reconnect.spec.ts tests/e2e/comprehensiveMacroUiBehaviorCurrent.spec.ts

test-20260723c-010:
    HISTFILE=/dev/null bun test tests/unit/macroDefinition034.core.test.ts tests/unit/macroDefinition034.action.test.ts tests/unit/macroDefinition034.control.test.ts tests/unit/macroValidationDecomposition010.test.ts
    HISTFILE=/dev/null bun test tests/unit/flowV2EditorCommands034.test.ts tests/unit/macroFlowVisualEditor006.test.ts tests/unit/macroRunnerExecution007.test.ts
    HISTFILE=/dev/null bun test tests/integration/macroRuntime034.prepare.test.ts tests/integration/macroRuntime034.execution.test.ts tests/integration/macroRuntime034.lifecycle.test.ts tests/integration/macroRuntime034.terminal.test.ts tests/integration/macroRuntime034.durability.test.ts tests/integration/agentEventWaitLimit038.test.ts
    bun run scripts/runPlaywright.ts --workers=1 tests/e2e/macroWorkbench034.flow.spec.ts tests/e2e/macroWorkbench034.record.spec.ts tests/e2e/macroWorkbench034.feedback.spec.ts tests/e2e/macroWorkbench034.layout.spec.ts tests/e2e/comprehensiveMacroUiBehaviorCurrent.spec.ts

test-20260723c-011:
    HISTFILE=/dev/null bun test tests/unit/parallelLaneEditor011.test.ts tests/unit/macroFlowVisualEditor006.test.ts tests/unit/flowV2EditorCommands034.test.ts tests/unit/macroDefinition034.control.test.ts tests/unit/workbenchThemeMigration003.test.ts tests/unit/uiThemeCloseout004.test.ts
    bun run scripts/runPlaywright.ts --workers=1 tests/e2e/macroWorkbench034.flow.spec.ts tests/e2e/macroWorkbench034.layout.spec.ts tests/e2e/comprehensiveMacroUiBehaviorCurrent.spec.ts

test-20260723c-012:
    HISTFILE=/dev/null bun test tests/unit/macroFlowVisualEditor006.test.ts tests/unit/flowV2EditorCommands034.test.ts tests/unit/macroDefinition034.control.test.ts tests/unit/workbenchThemeMigration003.test.ts tests/unit/uiThemeCloseout004.test.ts
    bun run scripts/runPlaywright.ts --workers=1 tests/e2e/macroWorkbench034.flow.spec.ts tests/e2e/macroWorkbench034.layout.spec.ts tests/e2e/comprehensiveMacroUiBehaviorCurrent.spec.ts

test-20260723c-013:
    HISTFILE=/dev/null bun test tests/unit/currentTestJourneyInventory010.test.ts tests/unit/uiBehaviorInventory031B.test.ts
    bun run scripts/runPlaywright.ts --workers=1 tests/e2e/roomLargeReplay032.stream.spec.ts tests/e2e/roomLargeReplay032.retention.spec.ts tests/e2e/roomLargeReplay032.lifecycle.spec.ts tests/e2e/roomRuntimeSync035.saved-content-save.spec.ts tests/e2e/roomRuntimeSync035.saved-content-create.spec.ts tests/e2e/roomRuntimeSync035.saved-content-reconnect.spec.ts tests/e2e/comprehensiveMacroUiBehaviorCurrent.spec.ts tests/e2e/comprehensiveUiBehaviorCurrent.spec.ts

test-20260723c-014:
    just file-size
    HISTFILE=/dev/null bun test tests/unit/fileSizeGate014.test.ts tests/unit/currentTestJourneyInventory010.test.ts tests/unit/uiBehaviorInventory031B.test.ts

test-20260724a:
    bun run test:20260724a
    HISTFILE=/dev/null bun test tests/integration/removedContentDomain20260724A.test.ts
    bun run scripts/runPlaywright.ts --workers=1 tests/e2e/workbenchThemeMigration003.spec.ts tests/e2e/businessThemeContrastC.spec.ts tests/e2e/appRoomTerminalChrome002.spec.ts tests/e2e/comprehensiveUiBehaviorCurrent.spec.ts tests/e2e/uiThemeCloseout004.spec.ts

test-20260724b:
    bun run test:20260724b
    bun run scripts/runPlaywright.ts --workers=1 tests/e2e/structuredJsonCapture20260724B.spec.ts

test-20260724c:
    bun run test:20260724c
    bun run scripts/runPlaywright.ts --workers=1 tests/e2e/macroEditorInputPerformance20260724C.spec.ts

test-20260724d:
    bun run test:20260724d
    bun run scripts/runPlaywright.ts --workers=1 tests/e2e/fullStackHotPaths20260724D.spec.ts tests/e2e/roomHome032.spec.ts tests/e2e/roomRuntimeSync035.runtime-input.spec.ts

test-20260725a:
    HISTFILE=/dev/null bun test tests/unit/macroStructuralIcons20260725A.test.ts tests/unit/workbenchThemeMigration003.test.ts tests/unit/uiThemeCloseout004.test.ts
    bun run scripts/runPlaywright.ts --workers=1 tests/e2e/macroWorkbenchFixes001.spec.ts

test-20260725b:
    HISTFILE=/dev/null bun test tests/unit/serverConsistency20260725B.test.ts tests/unit/fileSizeGate014.test.ts tests/unit/roomControlDecomposition004.test.ts tests/unit/terminalRoomDecomposition008.test.ts tests/unit/contentEditLeaseStateStore003.test.ts
    HISTFILE=/dev/null bun test tests/integration/incrementalTransport20260724D.test.ts tests/integration/terminalRoomWebSocket032.test.ts tests/integration/singleWriter033.test.ts

test-20260725c:
    HISTFILE=/dev/null bun test tests/unit/logStorageRetention20260725C.test.ts
    HISTFILE=/dev/null bun test tests/unit/macroRunStore034.test.ts
    HISTFILE=/dev/null bun test tests/unit/fullStackHotPaths20260724D.test.ts
    HISTFILE=/dev/null bun test tests/unit/agentEvent032.test.ts
    HISTFILE=/dev/null bun test tests/unit/serverCli032.test.ts
    HISTFILE=/dev/null bun test tests/integration/logStorageRetention20260725C.test.ts
    HISTFILE=/dev/null bun test tests/integration/agentEventWaitLimit038.test.ts
    HISTFILE=/dev/null bun test tests/integration/macroRuntime034.durability.test.ts
    HISTFILE=/dev/null bun test tests/integration/incrementalTransport20260724D.test.ts

test-20260722b-002-terminal-retention:
    bun run scripts/runPlaywright.ts --workers=1 tests/e2e/roomLargeReplay032.retention.spec.ts --grep "historical terminal queries"

debug-large-replay *args:
    bun run scripts/runPlaywright.ts --workers=1 tests/e2e/roomLargeReplay032.stream.spec.ts --grep "real Room PTY" {{args}}

diff-check:
    git diff --check

test-031b:
    bun run test:031b

notification-config-init:
    bun run scripts/initNotificationConfig.ts

notification-telegram-smoke profile="default":
    bun run scripts/smokeTelegramNotification.ts {{profile}}

test: test-unit test-e2e

# Shell-deck wrapped Codex entry. It is valid only inside a shell-deck-created Shell.
codex *args:
    bun run scripts/shell-deck-codex.ts {{args}}

# Submit one structured JSON value from stdin using this terminal's Room runtime context.
submit-json:
    bun run scripts/submitStructuredJson.ts
