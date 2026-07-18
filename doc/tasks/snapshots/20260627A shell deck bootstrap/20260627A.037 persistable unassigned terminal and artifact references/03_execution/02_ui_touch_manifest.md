# UI Touch Manifest

## 必须修改

* `MacroTerminalSelect.svelte`：从primitive index切换到terminal reference；Unassigned真实option与warning。
* `MacroStepList.svelte`、`ParallelLaneTabs.svelte`、`MessagePartsEditor.svelte`、`MacroEditorShell.svelte`：V4 defaults、source selector与slot-level warning。
* `MacroPanel.svelte`、`MacroJsonView.svelte`、`MacroRunDock.svelte`/validation区域：persistable/runnable/live三层状态与Start原因。
* `LibraryPanel.svelte`：Macro JSON Validate显示V4 valid-but-incomplete；其余Library CRUD/lease UI保持。

## 只允许机械类型更新

* Macro hierarchy、collapse、move/add/remove icon、panel尺寸与header。
* terminal tab/chrome、Home、Settings、Notice、Trace presentation。
* Library tabs/search/selector/metadata/lease/Copy/Load布局。

## 明确禁止

* 新增Macro级placeholder mode或全局Unassigned toggle。
* 用disabled空option替代可选Unassigned。
* 改变既有配色/字号/spacing/图标，除新增warning所需局部amber状态。
* 恢复Terminal layout前台section或自动Prepare。
