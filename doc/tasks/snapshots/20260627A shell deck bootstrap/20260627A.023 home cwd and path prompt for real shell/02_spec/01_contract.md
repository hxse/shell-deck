# Contract

## Real Shell Startup

* New real shell tabs default to the current user home directory.
* If the home directory cannot be determined, fall back to the server process cwd instead of failing terminal creation.
* The default bash prompt is `\[\e[1;92m\][\u@\h:\w]\$\[\e[0m\] `, so visible prompt text shows dynamic user, host, current working directory, shell marker, and a trailing separator space in bold bright green.
* For bash launched with `--noprofile --rcfile <shell-deck-generated bashrc>`, prompt and aliases must be provided by shell-deck because user profile files are intentionally skipped.

## Shell Aliases

* Bash real shell tabs load a shell-deck generated rcfile with color-friendly aliases for `ls`, `ll`, `la`, `l`, `grep`, and `diff`.
* The alias rcfile is project/runtime-owned; this task must not write to the user's real shell profile files.

## Terminal Font

* The browser terminal font stack prefers locally installed Maple Mono families before system monospace fallbacks, and the terminal renderer uses normal regular weight with bold weight for bold text.
* This task must not add font files, `@font-face`, remote font imports, or network font loading to the repo.

## Boundaries

* Fake terminal and text deck behavior are unchanged, except text deck editor monospace fallback may share the terminal font stack.
* The `just codex` wrapper and `SHELL_DECK_TARGET_CWD` behavior are unchanged.
* This task does not add per-terminal cwd configuration UI.
