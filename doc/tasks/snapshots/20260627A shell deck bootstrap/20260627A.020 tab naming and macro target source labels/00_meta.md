# 20260627A.020 Tab Naming And Macro Target Source Labels

* 父任务：`20260627A shell deck bootstrap`
* 状态：implementation-landed；automated gate passed
* 类型：post-v0 naming-contract-polish
* 前置任务：`20260627A.019 codex hook-only capture mode`
* 目标：把 deck tab 的默认 alias 从泛化 `terminal_N` 收敛为 backend-aware 的 `shell_N` / `text_N`，并把宏编辑器里用户可见的选择器文案统一为 `Target tab` / `Source tab` / `Lane tab`。
* 非目标：不改 macro JSON schema；不把 `terminal` 字段迁移为 `tab` 字段；不改 runner、terminal ref resolver、AgentEvent、hook 或 session 语义。
