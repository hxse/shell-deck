# AgentEvent Foundation Contract

Live ingest 的唯一入口为 `POST /api/rooms/:roomId/agent-events`。server 每次启动生成 memory-only ingest token，并只向自己创建的 Shell 注入 ingest URL/token、server/Room generation、terminalId 与 launchId。

request body 不能覆盖 path roomId。server 验证 token、当前 Room generation 以及 terminalId/launchId membership，再补 generated eventId、serverInstanceId 与 receivedAt，并追加到 User Data Root 的 Room-scoped evidence。不同 Room、generation、terminal 或 launch 的事件不能被消费。

`just codex` 只允许在具有完整注入 context 的 shell-deck Shell 内启动。普通外部 terminal 在启动 Codex 前以 `shell_deck_room_context_required` fail loudly；不存在 manual id、global ingest、disk spool/import、unbound evidence 或旧 config fallback。

`.034` 接回 Macro capture-source 后，只能消费与 run snapshot 的 serverInstanceId、roomId、roomGeneration、terminalId 和 launchId 全部匹配的 live evidence。成功 evidence 永不用于恢复 Room 或 runner。
