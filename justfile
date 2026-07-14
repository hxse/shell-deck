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

check: check-ts check-svelte

check-ts:
    bun x tsc --noEmit

check-svelte:
    bun x svelte-check --tsconfig ./tsconfig.json

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
