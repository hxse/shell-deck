# Execution Plan

## 阶段

1. 复核 `orch-web` 已验证的 terminal API 行为：WebSocket message、fan-out、late replay、reset transaction、real PTY input/resize、`.012` helper stdin pipe，以及 hook event lifecycle；记录哪些只作参考，哪些明确不迁移。
2. 写最小 terminal deck API probe harness：config、terminal、WebSocket subscribe、snapshot、`pty_output`、input、resize、reset、capture-buffer，字段以 `configId + terminalId` 为主键。
3. 写最小 `codex` just recipe 草案，只负责透传参数和注入临时 hook config。
4. 写最小 hook receiver / file sink / local HTTP ingest，能记录 SessionStart、Stop 和归一化后的 AgentEvent。
5. 用环境变量模拟 terminal id，运行 `just -f <shell-deck-root>/justfile -- codex` 和 `just -f <shell-deck-root>/justfile -- codex resume --last`。
6. 执行 API Probe Matrix A01-A07：验证 hook payload、last assistant message、session_id、turn_id、`configId`、`terminalId`、`launchId`、token、spool 和 Codex session id 双写。
7. 执行 API Probe Matrix T01-T12：验证 multi-tab sync、replay、config isolation、input/resize、long paste、no local echo、reset transaction、capture artifact、index->id remap 和 `just codex` env 继承。
8. 验证不依赖 `terminalIndex` 也能把 adapter 上报的 `AgentEvent` 归属到 stable terminal id。
9. 形成 API probe 结果，并更新后续子任务 contract。

## Close Gate

* 明确 `codex` just recipe 是否可以只用临时 config 注入 hook。
* 明确 hook 是否能稳定带回 `configId`、`terminalId`、`launchId`。
* 明确 Stop hook 是否能带回必填 Codex `session_id` 和 `last_assistant_message`。
* 明确 terminal deck API baseline 是否足够支撑 `.002`，包括 WebSocket subscribe、snapshot、`pty_output`、input、resize、reset 和 capture-buffer。
* 明确 `orch-web` 的 helper stdin pipe 输入优化是否直接作为 shell-deck V0 real PTY 控制通道。
* 明确 multi-tab sync、late replay、config isolation、stable terminal id 和 index->id remap 是否可行。
* 明确本任务没有修改用户全局 Codex 配置，也没有把 `orch-web` role API 迁移进 shell-deck 核心。
* `just test-001-offline` 通过；online probe 通过或记录 blocked reason。
* 人工 review API Probe Matrix、go/no-go 和 artifacts，并写入 `04_review/**`。
