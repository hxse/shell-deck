set shell := ["bash", "-eu", "-o", "pipefail", "-c"]

default:
    just --list

# Start the local-only shell-deck server. ai-json is disabled unless an explicit AI mode entry is used.
start *args:
    bun run server/httpServer.ts --ai-json-parser disabled {{args}}

start-mock-ai *args:
    bun run server/httpServer.ts --ai-json-parser mock {{args}}

start-codex-ai *args:
    bun run server/httpServer.ts --ai-json-parser codex-exec {{args}}

stop *args:
    bun run scripts/stop-server.ts {{args}}

# Development server entry. The server serves Vite-built assets when present and exposes WebSocket APIs.
dev *args:
    bun run server/httpServer.ts --ai-json-parser disabled {{args}}

dev-mock-ai *args:
    bun run server/httpServer.ts --ai-json-parser mock {{args}}

dev-codex-ai *args:
    bun run server/httpServer.ts --ai-json-parser codex-exec {{args}}

check:
    bun run check

build:
    bun run build

test-unit:
    bun run test:unit

test-e2e:
    bun run test:e2e

test-002:
    bun run test:002

test-003:
    bun run test:003

test-004:
    bun run test:004

test-005:
    bun run test:005

test-006-offline:
    bun run test:006:offline

test-006-online:
    SHELL_DECK_RUN_ONLINE=1 bun run test:006:online

test-007-offline:
    bun run test:007:offline

test-007-online:
    bun run test:007:online

test-008-offline:
    bun run test:008:offline

test-008-online:
    bun run test:008:online

test-008: test-008-offline

test-009-offline: check build test-unit test-e2e test-001-offline test-002 test-003 test-004 test-005 test-006-offline test-007-offline test-008-offline

test-009: test-009-offline

test-010-shell-gui:
    SHELL_DECK_E2E_AI_JSON_PARSER=mock bun run scripts/runPlaywright.ts --workers=1 tests/e2e/macroTemplateWorkbench.spec.ts tests/e2e/captureSourceFlow.spec.ts tests/e2e/runLogView.spec.ts tests/e2e/macroRunnerState.spec.ts tests/e2e/parallelAll.spec.ts tests/e2e/macroRealShellGui.spec.ts tests/e2e/macroRealShellMatrix.spec.ts
    SHELL_DECK_E2E_AI_JSON_PARSER=disabled bun run scripts/runPlaywright.ts --workers=1 tests/e2e/parserFailureGui.spec.ts

test-010-codex-gui:
    bun run scripts/probe-010-codex-gui.ts

test-010-offline: check test-unit test-e2e test-010-shell-gui

test-010: test-010-offline

test-011:
    bun run test:011

test-012:
    bun run test:012

test-013:
    bun run test:013

test-014:
    bun run test:014

test-016:
    bun run test:016

test-017:
    bun run test:017

test-018:
    bun run test:018

test-019:
    bun run test:019

test-020:
    bun run test:020

test-021:
    bun run test:021

test-022:
    bun run test:022

test-023:
    bun run test:023

test-024:
    bun run test:024

test-025:
    bun run test:025

test-026:
    bun run test:026


test-027:
    bun run test:027
notification-config-init:
    mkdir -p .shell-deck
    cp -n config/notification-profiles.example.json .shell-deck/notification-profiles.json

notification-telegram-smoke profile="default":
    bun run scripts/smokeTelegramNotification.ts {{profile}}

test-007: test-007-offline

test-006: test-006-offline

test: test-unit test-e2e

# Run the deterministic .001 API probe. No network and no real model call.
test-001-offline:
    bun run test:001:offline

# Run the real Codex .001 probe. This can use network/auth/model quota.
test-001-online:
    SHELL_DECK_RUN_ONLINE=1 bun run test:001:online

# Convenience alias for the safe .001 probe only.
test-001: test-001-offline

# Shell-deck wrapped Codex entry. With `just -f`, Codex runs in the invocation directory, not the shell-deck repo. Put -- before codex when forwarding Codex flags:
#   just -f <shell-deck-root>/justfile -- codex --help
#   printf 'Reply with ok\n' | just -f <shell-deck-root>/justfile -- codex exec -
codex *args:
    SHELL_DECK_TARGET_CWD={{quote(invocation_directory())}} bun run scripts/shell-deck-codex.ts {{args}}
