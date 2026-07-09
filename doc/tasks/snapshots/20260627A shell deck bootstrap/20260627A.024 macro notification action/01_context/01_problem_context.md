# Problem Context

Macro runs can already send text to terminals, wait, capture, extract, branch, and merge parallel lane output. Users still need an explicit way to notify themselves when a macro reaches an important point or completes.

The notification path must fit shell-deck's local-first and public-repo constraints:

* Macro templates are shareable JSON and must not store Telegram bot tokens or private channel ids.
* Runtime secrets belong in ignored local config under `.shell-deck/`.
* The Git-tracked repo may include an example config that users copy into their local runtime config.
* Telegram notifications should support private channels by accepting a bot token and channel id in the local profile.
* Browser system notifications require user-granted browser permission; macro execution must not assume it can request that permission automatically.
