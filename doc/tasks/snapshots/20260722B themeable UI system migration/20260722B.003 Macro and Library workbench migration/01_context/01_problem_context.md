# Problem Context

## 当前workbench规模

Macro/Library presentation当前由`macro-workbench.css` aggregator加载`macro-chrome.css`、`macro-editor.css`、`macro-flow.css`、`macro-trace.css`、`library-workbench.css`、`workbench-responsive.css`和`workbench-shared.css`，另有10个Macro component-local `<style>`。八个external module合计约2,489行，内部存在重复selector和依赖source order的cascade。

current `tests/unit/macroWorkbenchStyles009.test.ts`正是为机械拆分后的behavior preservation建立：它展开旧import并冻结516条rule、637条semantic rule、重复selector/property顺序和file manifest。这对`.009`历史目标是正确oracle，但在本任务有意删除旧CSS后不能继续作为current真值。

## 不能简单套component default

Macro workbench的高度和宽度预算远小于普通form application。按钮、select、input、nested card、lane tab、run control和trace row都依赖紧凑padding/gap；daisyUI默认`btn`/`input`尺寸若不显式收紧，会立刻改变panel宽度、换行、scroll owner和操作路径。迁移必须从current measurable density反推utility，而不是接受library demo layout。

## 必须保留的近期修复

`20260722A.001`刚完成并已成为current truth：For text-list每项拥有向上/向下插入icon action；active run期间authoring明确readonly；run dock/current node更清晰；Parallel authoring不再收集text output；loop title/template勾选后只显示三个紧凑token insert buttons。Theme迁移必须把这些状态作为baseline，不得恢复旧提示、弱disabled或可编辑外观。

## Macro关键状态

同一DOM需要表达controller/observer、view/edit lease、clean/dirty、valid/persistable/not-runnable/invalid、visual/JSON、pending、active run locked、paused/waiting input、current root/nested/parallel lane node和terminal readiness。Theme token要增强这些状态的层次，同时不能用颜色作为唯一信息，也不能改state machine决定何时disabled。

## Library关键状态

Library side panel包含kind tabs、search、selector、saved detail、New/Edit、lease lost、published Create preservation、validation和Macro Load。其width/visibility由browser settings和WorkspaceShell owner控制，`.003`只迁移内部presentation。所有selected/draft/dirty/operation/invalidation行为继续由`librarySession.svelte.ts`拥有。

## 新current oracle

旧CSS hash删除后，current test不能只断言“文件不存在”，也不能把迁移后结果再手写成新digest来自证正确。新的oracle以`20260722A.002`父revision生成并提交稳定的per-file non-presentation structure fixture；本任务25个workbench component必须逐文件匹配该真实父基线。其余current contract继续覆盖关键state的computed semantic token、compact geometry、nested/trace overflow和不同theme下无透明/固定light surface。历史`.009`snapshot及其review证据保持不修改。
