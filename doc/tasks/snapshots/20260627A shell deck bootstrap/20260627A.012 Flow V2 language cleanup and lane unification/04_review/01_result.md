# Result

状态：implementation-slice-landed。

本轮把 `.012` 从“parallel lane 也做完整 Flow V2 子语言”的方案，调整为用户确认的受限 fan-out / fan-in 方案：

* `parallel_all.lanes[*]` 只支持 `terminal`、`send.text`、`wait`、`capture`。
* lane 内不再支持 v1 `steps`，也不支持完整 Flow V2 `body`。
* lane 内禁止 `input_line`、`parse`、`if/for/break/continue/return`、`sleep until-resume`、nested `parallel_all`。
* 新增 `merge_parallel_results` action，用于机械合并并发 lane capture artifacts，产出 `merged_text`。
* 新增 `send_artifact` action，用于把 `merged_text` 或其他 step artifact 发送到指定 terminal。
* `parse` 改为显式 `source: { kind: "step_artifact", stepId, artifact }`，不再依赖旧的 `captureStep` 字段。
* Flow V2 validator 递归拒绝旧控制字段，包括嵌套在 `range`、`capture`、`parser.rules[]`、`join` 等对象里的字段。
* Flow V2 validator 校验 `merge_parallel_results` / `parse` / `send_artifact` 只能引用 `visible predecessor scope` 中的前序产物。
* Flow V2 validator 在没有 `indexMap` 时也能拒绝同 kind/value 的重复 lane terminal。
* 新增 `just test-012` targeted gate，覆盖上述 schema 行为。

没有在本轮实现 Flow V2 compiler/interpreter，也没有迁移现有 v1 template。v1 仍作为 legacy compatibility layer 保留。
