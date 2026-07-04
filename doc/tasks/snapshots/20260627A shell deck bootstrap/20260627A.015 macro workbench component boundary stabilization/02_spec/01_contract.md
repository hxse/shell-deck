# Contract

## Scope

范围内：

* 拆分 `MacroPanel.svelte` 的组件/文件边界。
* 拆分 `App.svelte` 中的 workspace shell / terminal tab chrome / side panel framing 边界，只做搬移，不改 WebSocket、terminal deck 或 panel persistence 行为。
* 拆分 `src/styles.css` 中的全局样式边界，把 terminal、workspace shell、macro workbench、prompt panel、run log 等 domain style 分离，保持视觉结果不变。
* 保持现有功能、逻辑语义、template schema、runner API、run log API、prompt storage、terminal deck 行为不变。
* 保持 `.014` Macro / Prompt / terminal workbench 视觉布局不变。
* 将 `.014` layout invariant 固化为后续任务必须继承的测试/验收边界。
* 为 `.016 Flow V2 action/message-flow redesign` 提供清晰的可编辑边界。
* 建立超过 400 行 UI/workbench 文件的处理口径：能在不改行为的前提下拆分的 UI 边界文件纳入本任务；runner/schema/API/terminal domain 大文件只记录为后续任务候选。

范围外：

* 不删除 `sleep` / `parse` / `ai-json` 等现有宏语义。
* 不实现 `parallel_send_capture`、`if.text_match` 或新的 message parts。
* 不修改 macro runner state machine。
* 不修改 active specs 的功能真值。
* 不重排 Macro header、Template drawer/bar、Run status dock、Editor/JSON/Trace tabs、Trace tab、Prompt panel、side panel frame 或 terminal tab chrome。
* 不拆分 `server/macroRunnerService.ts`、`src/lib/macro/templateSchema.ts`、`src/lib/macro/flowV2Schema.ts`、`server/httpServer.ts`、`server/terminalDeckManager.ts`；这些文件属于 runner/schema/API/terminal domain，应另开任务或放入对应功能任务。


## Large File Audit (>400 Lines)

基线扫描排除 `doc/tasks/snapshots/**`、`node_modules`、`dist` 和 `.shell-deck`。当前超过 400 行的源文件分为两组。

纳入 `.015`：

* `src/lib/components/MacroPanel.svelte`：约 938 行。必须拆；这是 `.014` 布局漂移的核心耦合点。
* `src/styles.css`：约 1963 行。可以拆；它把 terminal、workspace、macro、prompt、run log 样式揉在一个全局文件里，后续功能改动容易误伤布局。目标是按 domain 拆成样式文件或等价边界，视觉不变。
* `src/App.svelte`：约 443 行。可以有限拆；它同时处理 WebSocket、terminal tab chrome、side panel visibility/resize、notice 和页面装配。`.015` 只允许提取纯 UI shell/terminal tab/side panel frame/notice stack，不改协议和状态语义。

不纳入 `.015`，只记录后续候选：

* `server/macroRunnerService.ts`：约 964 行。值得拆，但它是 runner 执行语义核心；应单独做 runner boundary/refactor task。
* `src/lib/macro/templateSchema.ts`：约 672 行。值得拆，但它是 v1/current template schema validator；不应混入 UI/workbench 边界任务。
* `src/lib/macro/flowV2Schema.ts`：约 648 行。与 `.016` 功能语义直接相关，应在 `.016` schema phase 或单独 schema task 处理。
* `server/httpServer.ts`：约 578 行。值得拆 routes，但属于 API routing/server boundary，另开 server route task。
* `server/terminalDeckManager.ts`：约 411 行。刚超过阈值，但属于 terminal domain 核心；不纳入 `.015`。

纳入标准：只有“拆分后可通过 layout invariant 证明行为/视觉不变，并且不会改执行语义”的 UI/workbench 文件可以收进 `.015`。

## Component Boundary

目标拆分：

Workspace shell / App 层：

* `App.svelte`：保留顶层数据协调和 WebSocket message dispatch；减少直接持有的 UI chrome。
* `WorkspaceShell.svelte`：承载 terminal stage 与 side panel frame 的页面装配。
* `TerminalTabBar.svelte` 或等价组件：承载 terminal tab 选择、重命名、关闭、拖拽开关和 reorder UI；不改 terminal protocol。
* `WorkspaceSidePanels.svelte` 或等价组件：承载 Macro/Prompt 显示隐藏、拖拽宽度和 reset UI；不改 persisted layout schema。
* `NoticeStack.svelte`：搬移 notice 渲染与 dismiss UI。

Macro workbench 层：

* `MacroPanel.svelte`：只负责装配、数据加载、事件分发和当前 view 状态。
* `MacroWorkbenchChrome.svelte`：承载 `.014` workbench 外壳，组合 header、Template 区、Run dock 和 top-level tabs。
* `MacroTemplateSelector.svelte`：Template drawer/search/select 和 New/Save/Duplicate/Import/Export/Delete toolbar。
* `MacroRunDock.svelte`：runner status、runId/current step/pause reason、waiting input 和 debug refresh；不承载右侧 Run controls。
* `MacroEditorShell.svelte`：Editor 主区与右侧 tool rail 的横向布局边界。
* `MacroActionPalette.svelte`：右侧 tool rail，承载 Run controls 与现有 actions/flow 按钮区域；本任务只搬移，不改按钮语义。
* `MacroStepList.svelte`：当前宏节点编辑表单，也就是本任务的 node editor 边界；本任务只搬移，不改 schema 或保存结构。
* `MacroTraceView.svelte`：Trace tab 下的 Run Log / AI Trace 入口，并继续跟随 selected template。

Style boundary：

* `src/styles.css` 应收敛为入口或被按 domain 拆分；可拆成 `base.css`、`terminal.css`、`workspace.css`、`macro-workbench.css`、`prompt-panel.css`、`run-log.css` 等等价结构。
* 样式拆分只允许移动 selector 和整理 import 顺序，不允许改变 spacing、颜色、尺寸、breakpoint 或 selector 语义，除非 layout invariant 证明视觉完全等价。

组件边界规则：

* Workbench chrome 组件不得 import node editor 内部实现细节。
* Node editor / action palette 不得直接修改 Template selector、Run dock 或 Trace view 的布局。
* 组件之间通过 props/callbacks 传递状态，不新增隐式全局 store。
* 拆分允许移动代码，但不得借机改行为、改文案含义或改数据结构。
* 如果必须改 class/test id，必须同步 layout invariant e2e，并证明视觉/行为不变。

## Layout Invariants

拆分后必须保持 `.014` 的关键布局：

* Template 不与 Macro title / Editor tabs / New Save 等按钮挤在同一栏。
* Template drawer 默认折叠，展开后向下展开，不向右挤压 header。
* Template CRUD 按钮仍在同一个视觉组。
* Editor / JSON / Trace 是 Macro 顶层 views。
* Run status / waiting input 位于顶部 dock。
* Actions / Flow rail 位于 Editor 右侧，不能掉到 Editor 下方。
* Macro panel 和 Prompt panel 的显示/隐藏、拖拽宽度、持久化语义不变。
* Trace 跟随 selected template，Run Log / AI Trace 不制造第二份日志真值。
* 1080px 与常规桌面宽度下不横向溢出。


## Size Target

`.015` 完成后，目标是让 UI/workbench 大文件低于 400 行或给出明确例外：

* `MacroPanel.svelte` 应收敛为装配组件，显著低于 400 行。
* `App.svelte` 应只保留顶层协调逻辑，目标低于 400 行。
* `src/styles.css` 不应继续作为 1900+ 行单体样式文件；应拆分为 domain 样式边界。

这不是通用“所有文件都必须小于 400 行”的全仓规则；runner/schema/server/terminal domain 的大文件不在本任务强制拆分。

## Handoff to .016

`.016 macro action message flow redesign` 只能在本任务完成后开始实现。`.016` 允许修改 node editor / action palette / flow palette 内部语义；不允许修改本任务拆出的 workbench chrome 组件。
