set shell := ["bash", "-eu", "-o", "pipefail", "-c"]

default:
    just --list

# Start the local-only shell-deck server.
start *args:
    bun run start {{args}}

# Development server entry. The server serves Vite-built assets when present and exposes WebSocket APIs.
dev *args:
    bun run dev {{args}}

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
