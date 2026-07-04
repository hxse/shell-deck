# Execution Plan

## Phase 1: Baseline and Layout Contract

* 读取 `.014` Macro Workbench Layout contract。
* 记录当前 MacroPanel 组件职责和 layout invariant e2e 覆盖。
* 扫描超过 400 行的源文件，按 UI/workbench、runner/schema/API/terminal domain 分组。
* 确认本任务只纳入 `MacroPanel.svelte`、`App.svelte` 和 `src/styles.css` 这三个 UI/workbench 边界文件。
* 明确本任务不改功能、不改 schema、不改 runner。

## Phase 2: Workspace Shell Extraction

* 从 `App.svelte` 提取 terminal tab chrome，保持 select/rename/close/drag/reorder 行为不变。
* 从 `App.svelte` 提取 side panel frame，保持 Macro/Prompt show-hide、drag width、reset width 和 persistence 行为不变。
* 从 `App.svelte` 提取 notice stack，保持 notice 文案、dismiss 和生命周期不变。
* `App.svelte` 保留 configId、WebSocket message dispatch、terminal snapshots、layout persistence 协调逻辑。

## Phase 3: Macro Workbench Component Extraction

* 提取 `MacroTemplateSelector.svelte`，保持 Template drawer/search/CRUD 行为不变。
* 提取 `MacroRunDock.svelte`，保持 runner status、waiting input 和 debug refresh 行为不变；右侧 Run controls 保持在 tool rail。
* 提取 `MacroEditorShell.svelte`，保持 editor 主区和右侧 rail 布局不变。
* 提取 `MacroActionPalette.svelte`，只搬移右侧 Run controls 与 actions/flow 按钮，不改 action/flow 或 runner control 语义。
* 提取 `MacroStepList.svelte`，作为当前 node editor 边界，只搬移节点编辑表单，不改 template JSON。
* 提取 `MacroTraceView.svelte`，保持 Run Log / AI Trace 跟随 selected template。
* 让 `MacroPanel.svelte` 收敛为装配组件。

## Phase 4: Style Boundary Extraction

* 将 `src/styles.css` 按 domain 拆分，至少隔离 terminal、workspace shell、macro workbench、prompt panel、run log 样式。
* 样式拆分只移动 selector，不改变视觉 token、尺寸、breakpoint 或布局语义。
* 保留一个稳定样式入口，避免调用方到处 import 具体 domain style。

## Phase 5: Guardrails

* 新增或保留 `.014` layout invariant e2e，防止 header/template/run/tabs/trace/tool-rail 漂移。
* 增加组件边界检查说明：后续功能任务不得编辑 workbench chrome 组件。
* 保持 active specs 不变，直到功能任务真正落地。

## Phase 6: Gate

Close gate 需要：

* `just check`
* `just test-unit`
* `just test-e2e`
* `.014` Macro workbench layout invariant e2e
* 大文件目标检查：`MacroPanel.svelte`、`App.svelte` 和 `src/styles.css` 不再是未拆分单体；若仍超过 400 行必须在 review 中解释例外
* `git diff --check`

Manual smoke 不作为本任务强制项；本任务是组件边界 refactor，人工 smoke 可延后到 `.016` 功能实现或最终 closeout。
