# 20260729A Flexible Parallel shared Text routing

## 任务概括

把 Parallel 从“每个 lane 绑定一个 terminal、最后必须返回一段 text”改成“每个 pane 内自由顺序执行显式 target 的 Action”。Shell 仍由单一 pane 独占；Text 可以由单一 pane 独占，也可以由多个 pane 实时 append，并在 pane order 或 completion order 两种模式下保持可解释的写入顺序。

## 正式级别

三星任务。它破坏性修改 MacroDefinition、Parallel validation、visual authoring、runner 并发控制与 artifact visibility；共享 Text 的实时队列还涉及 pause、failure、Stop 和 partial side effect 等 quietly wrong 风险。

## 范围

范围内：MacroDefinitionV6 hard cut；Parallel Action 显式 terminal reference；删除 lane terminal、final Output、merge 与 `merged_text`；Shell 单 pane ownership；Text exclusive/shared 自动分类；shared Text 的 pane-order/completion-order 实时 append queue；相关 UI 状态与说明；runner、validation、测试、active specs、Quickstart 和 task index 同步。

范围外：自动清空或替换 Text；替用户判断 Text 是否“干净”；回滚已写入 Text 的 partial result；多个 pane 共享 Shell；Parallel 内 Input、user-continue Wait、structured-json Capture 或嵌套 control flow；旧 Macro schema migration、alias、dual-read 或 compatibility adapter。
