# Contract

## Flow V2 Notify Action

Flow V2 adds an action node:

```json
{
  "id": "notify_done",
  "type": "notify",
  "level": "success",
  "title": "Macro done",
  "message": { "parts": [{ "kind": "text", "text": "Review finished" }] },
  "channels": [
    { "kind": "app", "toast": true, "sound": "bell" },
    { "kind": "system" },
    { "kind": "telegram", "profileId": "default" }
  ],
  "onFailure": "continue"
}
```

* `level` is `info | success | warning | error`.
* `message` reuses the same ordered message parts contract as `send`; artifact refs are rendered at runtime.
* `channels` must be non-empty and may include `app`, `system`, and `telegram`.
* `app` means shell-deck built-in floating notification. `sound` is `none | bell | chime | ping | pulse | success | warning | alert`; new UI nodes default to `success`; `toast` controls the floating notice. Only one floating notice is visible; it stays until Dismiss or an outside click, and that outside click is consumed before normal workspace interaction. A newer app notification replaces the current notice. App sound volume is controlled by the browser-global Settings panel up to 1000% and is not stored in macro JSON.
* `system` means browser Notification API notification. The browser asks for permission when needed; denied, unavailable, or failed delivery is reported in the app floating notice and is not a runner failure.
* `telegram` references a local profile by `profileId`; the macro JSON must not contain bot token or channel id.
* The macro editor loads Telegram profile choices from the local runtime config and presents them as a select control.
* `onFailure` is `continue | pause | fail` and defaults in new UI nodes to `continue`.

## Telegram Profiles

Runtime reads Telegram credentials from:

```
.shell-deck/notification-profiles.json
```

The Git-tracked example lives at:

```
config/notification-profiles.example.json
```

The example file is not used by runtime. Users copy it to the local ignored path and fill in real values.

Profile shape:

```json
{
  "telegram": {
    "profiles": {
      "default": {
        "botToken": "123456:replace-me",
        "channelId": "-1001234567890",
        "disableWebPagePreview": true
      }
    }
  }
}
```

* `channelId` is a string and supports private channel numeric ids such as `-100...`.
* For private channels, the user must add the bot to the channel and grant send/admin permission as required by Telegram.
* Run events and WebSocket messages must not include `botToken` or `channelId`.

## Runner Behavior

* A notify step writes a notification message artifact and appends notification run events.
* App channels broadcast a `macro_notification` WebSocket message to clients in the same config. The payload includes notification time, notification id, run id, and step id.
* System channels are delivered by the browser client through the Notification API after the runner broadcasts the notification request. Telegram channels are delivered server-side. Telegram message text is fieldized as `field: value` lines and includes notification time, notification id, run id, and step id metadata.
* If Telegram profile lookup or delivery fails, `onFailure` decides whether the macro continues, pauses, or fails.
* Notify is allowed in root, if/elif/else, for body, and finish/break/continue action-only body.
* Notify is not a parallel lane action in V0; place notification after the parent `parallel` fan-in when all lane outputs are available.

## Just Entrypoints

* `just test-024` runs offline schema/service/runner/UI coverage and does not contact Telegram.
* `just notification-config-init` copies the tracked example to the ignored local runtime path without overwriting an existing config.
* `just notification-telegram-smoke <profile>` performs an explicit real Telegram send using local config.
