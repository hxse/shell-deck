# 20260723B.004 Centralize Macro Palette Lifecycle and Editor Controllers

## 任务概括

`MacroFlowNodeList.svelte`与`ParallelLaneTabs.svelte`继续渲染原有DOM并通过既有`updateDraft`gateway提交mutation；`MacroInsertionPalette.svelte`导出的唯一lifecycle controller承接两边重复的anchored placement、measured clamp、focus、Escape、resize和restore-focus。tree与lane domain mutation/collapse/ID edit分别移入两个Svelte controller。

## 正式 task 级别及定级原因

三星任务。

该重构同时覆盖递归Flow tree、Parallel lane invariant、两套floating modal-like palette和keyboard focus。任一DOM/control order、anchor/mutation path或focus restore漂移都会破坏authoring、accessibility或现有structure oracle。

## 范围内

* `MacroInsertionPalette.svelte`导出共享palette lifecycle controller并继续渲染现有root palette。
* 两个editor删除重复的position/clamp/focus/Escape/resize/restore算法，只保留open state与thin wiring。
* 新增`macroFlowTreeController.svelte.ts`，拥有Flow tree mutation、collapse/branch keys、node ID与text-list structure state。
* 新增`parallelLaneEditorController.svelte.ts`，拥有Parallel lane/action/output mutation、collapse与ID/label notice state。
* 现有DOM hierarchy、element/attribute inventory、control order、test id、class、focus结果和`updateDraft`入口保持。

## 范围外

* 不重做Macro UI、不改变schema/default/validation/runner/terminal reference。
* 不把draft复制到controller，不建立第二个mutation gateway或generic editor framework。
* 不把Parallel palette markup强行componentize而改变source/runtime结构。
