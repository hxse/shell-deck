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

check: ui-style-residue check-ts check-svelte

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

test-036:
    bun run test:036

test-037:
    bun run test:037

test-038:
    bun run test:038

test-039:
    bun run test:039

test-001:
    HISTFILE=/dev/null bun test tests/unit/macroDefinition034.test.ts tests/unit/runnerSnapshotMerge035.test.ts tests/unit/macroFlowVisualEditor006.test.ts tests/unit/workbenchThemeMigration003.test.ts tests/unit/currentTestJourneyInventory010.test.ts tests/unit/uiBehaviorInventory031B.test.ts
    bun run scripts/runPlaywright.ts --workers=1 tests/e2e/macroWorkbenchFixes001.spec.ts tests/e2e/comprehensiveMacroUiBehaviorCurrent.spec.ts tests/e2e/workbenchThemeMigration003.spec.ts tests/e2e/roomRuntimeSync035.takeover.spec.ts

test-002:
    HISTFILE=/dev/null bun test tests/unit/terminalParserWritePump.test.ts tests/unit/terminalViewState.test.ts
    bun run scripts/runPlaywright.ts --workers=1 tests/e2e/roomLargeReplay032.spec.ts

test-20260722b-001:
    bun run test:theme-foundation
    HISTFILE=/dev/null bun test tests/unit/browserSettings032.test.ts tests/unit/uiBehaviorInventory031B.test.ts
    bun run scripts/runPlaywright.ts --workers=1 tests/e2e/themeFoundation001.spec.ts tests/e2e/comprehensiveUiBehaviorCurrent.spec.ts tests/e2e/workbenchThemeMigration003.spec.ts

test-20260722b-002:
    HISTFILE=/dev/null bun test tests/unit/appRoomTerminalChrome002.test.ts tests/unit/themeFoundation001.test.ts tests/unit/terminalFont.test.ts tests/unit/uiBehaviorInventory031B.test.ts tests/unit/workbenchThemeMigration003.test.ts
    bun run scripts/runPlaywright.ts --workers=1 tests/e2e/appRoomTerminalChrome002.spec.ts tests/e2e/themeFoundation001.spec.ts tests/e2e/roomHome032.spec.ts tests/e2e/roomLargeReplay032.spec.ts tests/e2e/comprehensiveUiBehaviorCurrent.spec.ts tests/e2e/workbenchThemeMigration003.spec.ts --grep-invert "visited terminal views survive Shell and Text tab switches"

test-20260722b-002-chrome:
    bun run scripts/runPlaywright.ts --workers=1 tests/e2e/appRoomTerminalChrome002.spec.ts tests/e2e/workbenchThemeMigration003.spec.ts

test-20260722b-003:
    HISTFILE=/dev/null bun test tests/unit/uiStructureBaseline003.test.ts tests/unit/workbenchThemeMigration003.test.ts tests/unit/themeFoundation001.test.ts tests/unit/appRoomTerminalChrome002.test.ts tests/unit/uiBehaviorInventory031B.test.ts tests/unit/currentTestJourneyInventory010.test.ts tests/unit/macroFlowVisualEditor006.test.ts tests/unit/librarySession005.test.ts
    bun run scripts/runPlaywright.ts --workers=1 tests/e2e/workbenchThemeMigration003.spec.ts tests/e2e/macroWorkbenchFixes001.spec.ts tests/e2e/comprehensiveMacroUiBehaviorCurrent.spec.ts tests/e2e/libraryWorkbench036.crud.spec.ts tests/e2e/libraryWorkbench036.navigation.spec.ts tests/e2e/libraryWorkbench036.races.spec.ts tests/e2e/libraryWorkbench036.reconnect.spec.ts

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
    bun run scripts/runPlaywright.ts --workers=1 tests/e2e/singleWriterRoom033.spec.ts tests/e2e/roomRuntimeSync035.takeover.spec.ts tests/e2e/roomHome032.spec.ts tests/e2e/roomLargeReplay032.spec.ts

test-20260723b-002:
    HISTFILE=/dev/null bun test tests/unit/macroInvalidationQueue004.test.ts tests/unit/macroDefinition034.test.ts tests/unit/contentEditLease033.test.ts
    HISTFILE=/dev/null bun test tests/integration/macroRuntime034.durability.test.ts tests/integration/contentEditLeaseProcess033.test.ts
    bun run scripts/runPlaywright.ts --workers=1 tests/e2e/roomRuntimeSync035.saved-content.spec.ts tests/e2e/macroWorkbenchFixes001.spec.ts

test-20260723b-003:
    HISTFILE=/dev/null bun test tests/unit/librarySession005.test.ts tests/unit/libraryStore036.test.ts
    HISTFILE=/dev/null bun test tests/integration/libraryHttp036.test.ts tests/integration/libraryStoreProcess036.test.ts tests/integration/contentEditLeaseProcess033.test.ts
    bun run scripts/runPlaywright.ts --workers=1 tests/e2e/libraryWorkbench036.crud.spec.ts tests/e2e/libraryWorkbench036.navigation.spec.ts tests/e2e/libraryWorkbench036.races.spec.ts tests/e2e/libraryWorkbench036.reconnect.spec.ts

test-20260722b-002-terminal-retention:
    bun run scripts/runPlaywright.ts --workers=1 tests/e2e/roomLargeReplay032.spec.ts --grep "historical terminal queries"

debug-large-replay *args:
    bun run scripts/runPlaywright.ts --workers=1 tests/e2e/roomLargeReplay032.spec.ts --grep "real Room PTY" {{args}}

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
