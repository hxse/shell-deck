# AgentEvent Foundation Contract

Live ingest 的唯一入口为 `POST /api/rooms/:roomId/agent-events`。server 每次启动生成 memory-only ingest token，并只向自己创建的 Shell 注入 ingest URL/token、server/Room generation、terminalId 与 launchId。

request body 不能覆盖 path roomId。server 验证 token、当前 Room generation 以及 terminalId/launchId membership，再补 generated eventId、serverInstanceId 与 receivedAt，并追加到 User Data Root 的 Room-scoped evidence。不同 Room、generation、terminal 或 launch 的事件不能被消费。

`just codex` 只允许在具有完整注入 context 的 shell-deck Shell 内启动。普通外部 terminal 在启动 Codex 前以 `shell_deck_room_context_required` fail loudly；不存在 manual id、global ingest、disk spool/import、unbound evidence 或旧 config fallback。

Macro `capture-source`只能消费与frozen run snapshot的serverInstanceId、roomId、roomGeneration、terminalId和launchId全部匹配的live evidence。Start先为每个capture step记录matching baseline，后续只消费baseline之后且尚未被同一run消费的event；`prompt_and_result`还要求相同agent session/turn配对。等待过程服从同一live Pause/Stop状态。

AgentEvent Capture必须显式保存`waitLimit`。`{kind:"unbounded"}`无限等待匹配结果，直到成功、用户Stop、Room/launch失效、server restart或matching `agent.error`；不存在隐藏server timeout。`{kind:"timeout",timeoutMs}`只计算active waiting time，Pause期间冻结，超时以`agent_event_capture_timeout:<terminalId>` fail loudly。matching hook error以`agent_event_hook_error:<terminalId>`立即失败。迟到event只保留为evidence，不复活终态run；下一次Start的baseline必须忽略它。

成功capture写入run artifact与`artifact_created` evidence，但AgentEvent、artifact和Trace永不用于恢复Room或runner。server restart、Room generation或launch变化后，旧event不能满足新run capture。
