# Contract

## Default Alias Contract

When a tab is created without an explicit alias:

* `backend = real` uses the next available `shell_N` alias.
* `backend = fake` uses the next available `shell_N` alias.
* `backend = text` uses the next available `text_N` alias.
* Numbering is per prefix and skips aliases already in use.
* Explicit aliases and user renames keep their current validation and conflict behavior.
* Reordering tabs changes indexes only; aliases continue to follow terminal ids.

A fresh `just start` with an empty `local` config seeds:

* `shell_1` for the first real shell tab.
* `shell_2` for the second real shell tab.
* `text_1` for the text tab.

## Macro Editor Labels

The macro editor keeps JSON field names unchanged, including `terminal`. User-facing selector labels must use tab language:

* `send_line.terminal`: `Target tab`.
* `input_line.terminal`: `Target tab`.
* `wait(mode = terminal-quiet).terminal`: `Target tab`.
* `capture-source.capture.terminal`: `Source tab`.
* `parallel.lanes[*].terminal`: `Lane tab`.

The selector option label should be short and inspectable:

* Visible label: `#<index> | <alias> | <kind>`.
* Hover/title: index, alias, terminal id, and kind.
* `kind = shell` for `real` and `fake`; `kind = text` for text tabs.

## Scope Boundary

This task must not rename protocol fields, run event kinds, server message names, or TypeScript types such as `TerminalSnapshot`. Those are internal compatibility names. UI wording may use `tab`; schema and runner internals may continue to use `terminal`.
