# Problem Context

`.016` 把并发能力从旧 `parallel_all` 收窄为 `parallel_send_capture`，避免 lane 内出现完整控制流。但实际使用后，这个结构仍然偏复杂：

* UI 看起来像一个大表单，无法直观看出“多个并发 lane”。
* `send` / `wait` / `capture` 被包在 item 字段里，不像普通 action，复用感弱。
* 用户真实场景更接近：给多个终端并发发消息，各自等待和抓取，再选择每个 lane 的结果并合并。
* 当前 `parallel_send_capture` 默认形态不容易表达“这个 lane 最终返回什么”，用户需要从 merge 行为反推。

新的设计方向：

* `parallel` 显示为多个平行 lane tabs。
* 每个 lane 是一个小的顺序 action list，只允许 `send_line` / `wait` / `capture-source` / `extract_text`。
* 每个 lane 最后固定一个 `Output` 节点。
* `Output` 必须存在，必须是每个 lane 的最后一个节点，不可删除、不可移动、不可被普通 action 插到后面。
* `Output` 只声明该 lane 贡献给 parallel merge 的结果：选择某个前序 action artifact，或选择 `none`。

这让并发能力保持受限，但视觉和 JSON contract 都更接近用户心智：lane 做事，Output 产出，parallel 统一合并。
