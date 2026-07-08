# Result

Status: implementation-landed; automated gate passed.

Implemented:

* Default tab aliases are backend-aware: shell/fake/real create `shell_N`, text creates `text_N`.
* Fresh seeded `local` config now documents and tests `shell_1`, `shell_2`, `text_1`.
* Macro editor selectors use `Target tab`, `Source tab`, and `Lane tab` user-facing labels.
* Selector options now show `#<index> | <alias> | <kind>` with full id details in hover text.
* Close-tab copy uses `Close tab` instead of `Close terminal`.
* Active specs were updated; protocol/schema field names remain unchanged.
