set shell := ["bash", "-eu", "-o", "pipefail", "-c"]

default:
    just --list

# Run the deterministic .001 API probe. No network and no real model call.
test-001-offline:
    bun run test:001:offline

# Run the real Codex .001 probe. This can use network/auth/model quota.
test-001-online:
    SHELL_DECK_RUN_ONLINE=1 bun run test:001:online

# Convenience alias for the safe .001 probe only.
test-001: test-001-offline

# Shell-deck wrapped Codex entry. Put `--` before `codex` when forwarding Codex flags:
#   just -f <shell-deck-root>/justfile -- codex --help
#   printf 'Reply with ok\n' | just -f <shell-deck-root>/justfile -- codex exec -
codex *args:
    bun run scripts/shell-deck-codex.ts {{args}}
