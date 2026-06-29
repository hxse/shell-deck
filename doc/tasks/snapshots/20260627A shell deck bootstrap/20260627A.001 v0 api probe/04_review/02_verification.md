# Verification

已运行：

```bash
just test-001-offline
just -f <shell-deck-root>/justfile -- codex --help
just test-001-online
```

结果：

* `just test-001-offline`：通过，3 tests / 37 assertions。
* `just -f <shell-deck-root>/justfile -- codex --help`：通过，真实 Codex CLI help 正常输出。
* `just test-001-online`：通过，真实 Codex CLI 返回 SessionStart 和 Stop hook，Stop payload 包含 `last_assistant_message=shell-deck-online-probe`。

证据路径：

* offline summary：`.shell-deck/probe-results/001-offline/result.json`
* latest online summary：`.shell-deck/probe-results/001-online/2026-06-27T12-33-22-622Z/result.json`
* latest online events：`.shell-deck/probe-results/001-online/2026-06-27T12-33-22-622Z/events.jsonl`
* latest online last message：`.shell-deck/probe-results/001-online/2026-06-27T12-33-22-622Z/last-message.md`

`.shell-deck/` 已在 `.gitignore` 中，probe artifacts 保留在本机作为运行证据，不进入版本库。
