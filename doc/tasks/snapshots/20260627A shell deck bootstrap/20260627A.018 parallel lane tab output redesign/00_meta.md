# 20260627A.018 Parallel Lane Tab Output Redesign

* 父任务：`20260627A shell deck bootstrap`
* 状态：implementation-landed；automated gate passed
* 类型：post-v0 macro-language-ux-design
* 前置任务：`20260627A.017 macro node insertion interaction redesign`
* 目标：把 `.016/.017` 的 `parallel_send_capture` 重新收敛为更直观的 `parallel` lane tab 模型：每个 lane 是一个可视化 tab，lane 内只允许顺序配置 `send_line` / `wait` / `capture-source` / `extract_text` 四类普通 action，并以固定 `Output` 收尾；`Output` 必须存在、必须是每个 lane 的最后一个节点、不可删除，用于声明该 lane 最终贡献给 parallel merge 的结果。
* 非目标：不恢复 `parallel_all` / `merge_parallel_results`；不允许 lane-local `if/for/break/continue/finish/input_line`；不引入 AI parser action；不做 drag-and-drop lane 排序；不改变单 config 单 live macro run 规则。
