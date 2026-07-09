# Result

## Summary

* Real PTY backend now starts helper/shell processes from the current user home directory by default.
* If home cannot be resolved to a directory, startup falls back to the server process cwd.
* Bash prompt default is `\[\e[1;92m\][\u@\h:\w]\$\[\e[0m\] `, so terminal prompt shows dynamic user, host, and current path in bold bright green with a trailing separator space instead of only `$`.
* PTY helper no longer overwrites an already-provided `PS1` with `$ `.
* Bash real shell startup now uses a shell-deck generated rcfile for color-friendly aliases: `ls`, `ll`, `la`, `l`, `grep`, and `diff`.
* Browser terminal font fallback now prefers locally installed Maple Mono variants, uses a normal regular weight, and keeps repo/network font loading out of scope.
* `terminal_deck_contract.md` now records the real shell cwd/prompt/font contract.

## Review

* P1: none.
* P2: none.
* P3: none.
