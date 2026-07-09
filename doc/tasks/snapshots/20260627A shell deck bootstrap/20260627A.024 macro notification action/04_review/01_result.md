# Result

## Summary

* Added Flow V2 `notify` action with `level`, `title`, message parts, explicit channels, and `onFailure` handling.
* Added schema/type/editor/runner support for app, system, and Telegram notification channels.
* App channels now broadcast `macro_notification` to browser clients; app channel shows one manually dismissed floating notice with selectable named built-in sounds. System channel is delivered through the browser Notification API; if permission is missing, the browser requests it and reports denied/unavailable state in the app floating notice.
* Telegram delivery is server-side through local profiles at `.shell-deck/notification-profiles.json`.
* Added tracked `config/notification-profiles.example.json`, `just notification-config-init`, and explicit `just notification-telegram-smoke <profile>`.
* Telegram profile selector now loads profile ids from the local runtime config through a server API; the normal UI path is a select, not a free-text input.
* Run events, app floating notices, browser system notifications, and Telegram messages carry notification time/id plus run id and step id without bot token or channel id. Telegram text is fieldized as `field: value` lines.
* Moved global UI controls into the rightmost topbar Settings popover: Insert placement, notification volume up to 1000%, and tab Drag. All three are browser-local Settings preferences stored in localStorage; the popover closes on outside click.
* Active macro template contract now documents `notify` and the Telegram profile boundary.

## Review

* P1: none.
* P2: none.
* P3: real Telegram delivery is intentionally only covered by explicit smoke because it depends on user-owned bot token, channel permission, network, and Telegram availability.
