# 20260721A.004 Split Macro Panel Sessions

## 任务概括

将`src/lib/components/MacroPanel.svelte`中saved record会话、visual/JSON draft、content lease、异步operation、remote invalidation、Prepare/Start和runtime input协调拆成小型per-panel session。MacroPanel继续渲染现有chrome/editor/trace并组合这些session。

## 正式 task 级别及定级原因

三星任务。

MacroPanel包含大量await continuation与generation/identity复核。错误抽取会覆盖更晚draft、复活旧lease、吞掉remote Save/Delete或让completed run继续锁UI。该任务必须按state ownership拆，而不是简单移动函数。

## 范围内

* 抽取MacroRecord selection/draft/lease/save会话。
* 抽取JSON edit buffer与candidate commit会话。
* 抽取server invalidation queue/replay协调。
* 抽取Prepare/runner/runtime input client会话。
* 保留MacroPanel现有markup、props/events和视觉结构。

## 范围外

* 不改变MacroDefinitionV5、AgentEvent exact wait-limit、Save/Start validation或explicit Prepare规则。
* 不同步browser-local selection/draft/json buffer。
* 不改变controller/content lease、published Create preservation与reconnect contract。
* 不建立与Library共用的泛化`ContentSession<T>`。
