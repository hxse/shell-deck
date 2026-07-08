# 20260627A.019 Codex Hook-Only Capture Mode

* 父任务：`20260627A shell deck bootstrap`
* 状态：implementation-landed；automated gate passed
* 类型：post-v0 hook-adapter-contract-fix
* 前置任务：`20260627A.018 parallel lane tab output redesign`
* 目标：把 `just codex` wrapper 与 `agent-event` capture 收敛到 Codex hook 明确支持的字段：`UserPromptSubmit.prompt` 和 `Stop.last_assistant_message`；修复 wrapper cwd/data-root 分离后 hook spool 写错目录的问题；新增 `captureMode`，删除旧 `eventKind` / `field` macro 模板语法。
* 非目标：不读 Codex transcript；不抓 TUI；不消费 `codex exec --json`；不捕获 reasoning、tool calls、command execution details 或中间步骤。
