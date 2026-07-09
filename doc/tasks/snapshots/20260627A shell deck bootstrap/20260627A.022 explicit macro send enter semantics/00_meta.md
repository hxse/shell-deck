# 20260627A.022 Explicit Macro Send Enter Semantics

* 父任务：`20260627A shell deck bootstrap`
* 状态：spec-drafted; implementation pending
* 类型：post-v0 macro-language-contract-fix
* 前置任务：`20260627A.021 tab capability aware macro controls`
* 目标：把 Macro Flow V2 的发送动作从隐式 `send_line` / `input_line` 收敛为显式 `send` / `input`，用结构化 `enter: boolean` 表达是否提交，并把 runner 的提交符统一为 LF。
* 非目标：不做旧模板兼容迁移；不自动 trim 用户文本；不把补充提交符写回 `message`；不引入 CR/LF 用户选项；不改变 `wait` / `capture-source` / `extract_text` 的职责。
