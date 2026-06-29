# 20260627A.001 V0 API Probe

## 任务概括

验证 V0 底层 API 是否可行：一条线验证 `just codex` recipe 能临时注入 Codex hook 并生成 AgentEvent；另一条线参考 `orch-web` 已验证的 terminal API，重新冻结 shell-deck 的 config/terminal/WebSocket/PTY input/capture baseline。

## 正式 task 级别及定级原因

二星任务。

本任务是 V0 的技术风险探测，不交付完整产品 UI，但会决定后续 terminal foundation、capture source、AgentEvent 和 parser 的 API 主路径。如果临时 hook 注入、环境变量透传、terminal deck API、multi-tab sync 或 helper stdin pipe 输入通道不可行，后续任务必须提前收缩。

## 范围内

* 设计并验证 `codex` just recipe。
* 验证 `codex` just recipe 不写入 `~/.codex/config.toml`，只使用临时 config override 或临时 profile。
* 验证 Codex hooks 可以捕获 `SessionStart` 和 `Stop` payload。
* 验证 hook command 能读取 `SHELL_DECK_*` 环境变量。
* 验证 `last_assistant_message` 能进入 shell-deck ingest event。
* 验证 hook adapter 上报的 AgentEvent 能通过 stable terminal id 归属到正确 terminal；位置变化由 `.002` 的 index/id map 测试覆盖。
* 参考 `orch-web` 已测过的 terminal API 行为，重新验证 shell-deck 的 WebSocket snapshot/fan-out/replay、input、resize、reset、config isolation 和 terminal-buffer capture baseline。
* 验证 real PTY 输入通道采用 helper stdin pipe，避免 command-file polling 造成输入延迟。
* 输出 API probe 结论，作为 `.002 terminal deck foundation`、`.006 capture source and agent event adapters`、`.007 parser profiles and adapters` 的输入约束。

## 范围外

* 不实现完整 terminal deck。
* 不实现完整 macro runner。
* 不接入真实 `ai-json` parser。Regex/parser 实现留给 `.007`。
* 不修改用户全局 Codex 默认行为。
* 不要求自动恢复 Codex session。
* 不迁移 `orch-web` 的 role/role_call/validator-call 编排 API。
