# 20260627A.015 Macro Workbench Component Boundary Stabilization

* 父任务：`20260627A shell deck bootstrap`
* 状态：implementation-landed；automated gate passed
* 类型：post-v0 architecture-boundary-refactor
* 目标：在不改变功能、逻辑语义和视觉布局的前提下，拆分 Macro/workspace workbench 的组件、样式和文件边界，把 `.014` 已冻结的 workbench chrome 与后续 Flow V2 action/message-flow 改造隔离开。重点覆盖超过 400 行且直接影响 UI 边界的 `MacroPanel.svelte`、`App.svelte` 和 `styles.css`。
* 非目标：不修改 macro template schema；不修改 macro runner 行为；不引入 Flow V2 新语义；不重排 `.014` Macro / Template / Run / Editor / JSON / Trace / Prompt 布局；不更新 active specs 的功能语义。
