# Problem Context

## Finding

`MacroFlowNodeList.svelte`为696行，`ParallelLaneTabs.svelte`为607行；两者同时承担render、domain mutation、collapse/ID state和floating insertion palette。根Flow与lane palette各自实现近乎逐行相同的initial viewport placement、measured clamp、first-control focus、Escape、resize和trigger focus restoration。

## 为什么重要

同一interaction有两份真值，窄viewport或focus修复容易只进入一边。组件内约49/41个local function又把domain invariant与render wiring混在一起，使结构性变化难以确认是否仍只经过`updateDraft`。

## Existing truth

* `flowV2EditorCommands.ts`与`macroEditorDefaults.ts`继续是schema-level mutation/default primitive。
* `MacroInsertionPalette.svelte`是root palette现有UI owner；Parallel palette runtime DOM与其shell规则相同但body较窄。
* `20260722A.002` per-file structure fixture、`.003/.004` source inventory及current browser journeys冻结DOM/control order。
* `macroWorkbench034.flow/layout`与`comprehensiveMacroUiBehaviorCurrent`覆盖anchored/centered、nested flow、lane action、cancel与mutation。
