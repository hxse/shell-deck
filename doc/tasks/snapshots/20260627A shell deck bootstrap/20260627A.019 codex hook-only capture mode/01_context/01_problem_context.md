# Problem Context

`.019` 来自真实使用反馈：用户在一个 terminal 中用 `just -f <shell-deck-root>/justfile -- codex` 启动 Codex，再用 macro `capture-source(agent-event)` 抓 Codex Stop hook 输出并转发到另一个 text terminal。

最初链路已经能抓到 `Stop.last_assistant_message`，但暴露了两个问题：

* `just -f` wrapper 让 Codex 正确运行在用户调用目录后，hook 进程也继承了目标 cwd；如果没有显式传 `SHELL_DECK_DATA_ROOT`，offline spool 会写进目标项目的 `.shell-deck`，server 无法导入。
* `agent-event` capture 只有旧的 `eventKind=stop` / `field=last_assistant_message` 写法，无法表达“只抓 prompt / 只抓 result / prompt + result”。

对 Codex hook API 的实际 probe 结果：

* `UserPromptSubmit` hook payload 包含 `prompt`。
* `Stop` hook payload 包含 `last_assistant_message`。
* 两者都包含 `session_id`、`turn_id`、`transcript_path`、`cwd`、`model` 等元数据。

本任务明确只使用 hook payload 直接给出的稳定字段，不向 transcript/TUI/JSONL event stream 扩张。
