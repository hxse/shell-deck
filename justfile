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

# Shell-deck wrapped Codex entry. Put -- before codex when forwarding Codex flags:
#   just -f <shell-deck-root>/justfile -- codex --help
#   printf 'Reply with ok\n' | just -f <shell-deck-root>/justfile -- codex exec -
codex *args:
    bun run scripts/shell-deck-codex.ts {{args}}
