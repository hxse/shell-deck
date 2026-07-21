# Contract

## 任务边界

### Added Semantics

无。

### Frozen Semantics

* 全部Action/Flow可视化字段、默认值、selector候选与JSON mutation冻结。
* Add Before/After/Inside、Add Text/Elif/Else、Remove、Move Up/Down、折叠和branch/lane操作冻结。
* Unassigned始终可选且新eligible slot默认Unassigned的行为冻结。
* artifact earlier/scope候选顺序、outer/lane-local可见性和output capability冻结。
* terminal reference/layout authoring、id生成、删除/移动后invalid reference保留冻结。
* root与Parallel lane AgentEvent Capture的默认unbounded、Enable timeout、duration input与exact JSON branch冻结。
* DOM顺序、CSS classes、缩进线、按钮图标/tooltip、focus、multiline autosize与test id冻结。

### Primary files

* `src/lib/components/macro/MacroStepList.svelte`
* `src/lib/components/macro/ParallelLaneTabs.svelte`

## 任务规范

### 目标模块

* `MacroFlowNodeList.svelte`：递归列表、深度/路径、collapsed state投影与node chrome组合。
* `MacroActionNodeEditor.svelte`：Send/Wait/Input/Notify/Capture/Extract等Action字段选择，不拥有list mutation。
* `MacroControlNodeEditor.svelte`：For/If/Parallel/Finish内部composition，显式创建nested lists/lanes。
* `MacroInsertionPalette.svelte`：现有Add语义按钮和placement command绑定。
* `CaptureSourceEditor.svelte`、`ExtractTextEditor.svelte`：root/lane真正共用的字段组。
* `macroEditorDefaults.ts`：current-schema exact node/default factory。
* `macroArtifactChoices.ts`：pure outer/lane-local earlier output计算。

最终可合并过小组件，但不得回到单个巨型switch，也不得创建generic schema form。

### Mutation boundary

所有结构mutation仍通过`flowV2EditorCommands`和MacroEditorShell统一`updateDraft`防御入口。子组件只发typed command或提交完整field replacement，不直接绕过readonly/pending guard修改bound object。

### Scope规则

* root/branch choice由当前位置之前的compatible outputs计算。
* lane Extract/Message可见outer earlier与该lane earlier outputs，顺序与现状相同。
* sibling lane output不可见；lane Output仍保持自己的none/step artifact contract。
* UI choice helper只列候选，不执行validation、自动代选或reference repair。

### UI preservation

拆组件后必须尽量使用Svelte fragment/snippet避免新增layout wrapper。若技术上必须增加wrapper，需证明computed layout/accessibility不变，并在review说明；未说明即为越界。

## 示例

### 合法

outer Capture后插入Parallel，lane内Extract selector仍依次显示Unassigned、outer Capture以及该lane earlier outputs；选项value与最终JSON完全不变。

### 非法

* 把If/Elif/Else改成同一个动态schema表单，改变按钮/折叠位置。
* 为避免invalid draft，在move后自动把artifact source清成Unassigned。
* 抽组件时新增div，导致深度线、flex shrink或按钮对齐变化。

## 测试

### Unit

* default factory覆盖每个按钮产生的exact node。
* artifact choices覆盖root、For、If/Elif/Else、nested Parallel与lane scope/order。
* editor commands的insert/move/remove/id/collapse关联行为原样通过。

### Browser E2E

* 从空Macro只用UI触发除Codex/agent-event外全部Action与Flow按钮，构建并运行复杂Macro。
* `.038`独立离线UI journey继续覆盖root/lane AgentEvent wait-limit控件；本task不得以comprehensive journey排除Codex为由删除或改写它们。
* 覆盖每个selector、Unassigned、terminal layout、branch/lane、fold/move/remove和多终端capture结果。
* `.031B`冻结inventory在current允许差异之外无漂移；DOM/class与视觉截图保持等价。
* readonly/observer/pending点击结构按钮仍产生正确feedback。

### Gate

运行flow command/validation unit、Macro current E2E、comprehensive UI behavior、offline dogfood、`just check`、build与`git diff --check`。
