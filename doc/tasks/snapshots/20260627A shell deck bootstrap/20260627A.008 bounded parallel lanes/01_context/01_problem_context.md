# Problem Context

V0 当前设计不支持多个 macro run 并发，这是正确的默认约束：同一 config 内多个 run 同时向 terminal 自动发送输入，会让真实 shell/Codex TUI 发生不可预测交错。

但并发审阅有一个明确、可控的需求：把同一轮指令发送到多个不同 terminal，分别等待各自返回，用用户配置的通用 capture/parser/condition 判断每个 terminal 是否完成，全部成功后再继续。这不是多个宏并发，而是一个宏内部的 bounded fan-out/fan-in 节点。

因此本任务只新增 `parallel_all` 这一种有限并发能力。它复用已有通用路线：`terminal-buffer` 或 `agent-event` capture，`regex` 或 `ai-json` parser，结构化 typed condition。runner 不理解“审阅完成”等业务语义，只判断用户配置的条件是否成立。
