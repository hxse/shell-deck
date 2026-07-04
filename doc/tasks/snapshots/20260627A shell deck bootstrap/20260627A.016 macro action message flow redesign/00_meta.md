# 20260627A.016 Macro Action Message Flow Redesign

* 父任务：`20260627A shell deck bootstrap`
* 状态：implementation-landed；automated gate passed
* 类型：post-v0 macro-language-design
* 前置任务：`20260627A.015 macro workbench component boundary stabilization`
* 目标：在 Macro workbench 组件边界稳定后，重新收敛 Flow V2 的 action 与 message flow：删除新范式里的 `sleep`、`parse` 和内置 `ai-json` action，把文本获取统一为 `capture-source`，把文本传递统一为 `send_line` ordered parts，并把 `input_line` 收敛为 prompt + optional defaultSource，把文本判断下沉到 `if` 的结构化 match condition。
* 非目标：不实现内置 AI parser action；不引入字符串表达式或 JS eval 风格 DSL；不恢复 legacy v1 macro template 主路径；不修改 `.014` 已冻结的 Macro workbench chrome/layout。
