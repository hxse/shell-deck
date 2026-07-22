# 20260722B.003 Macro and Library Workbench Migration

## 任务概括

把Macro和Library workbench全部内部presentation迁移到daisyUI semantic token与Tailwind static utilities，覆盖chrome、editor、flow、trace、run dock、Library list/detail/editor及shared responsive states。删除对应八个CSS module、Macro component-local `<style>`和前序mixed-file中交接的workbench selectors，同时保留current DOM与所有authoring/runtime contract。

## 正式 task 级别及定级原因

三星任务。

该surface包含数十个Svelte component、nested Flow、Parallel lanes、template token、insertion palette、JSON editor、run trace、saved-record lease和高密度responsive cascade。虽然只允许presentation变化，但任何control隐藏、次序漂移、disabled弱化或overflow变化都会实质破坏Macro authoring，因此必须用结构、几何、状态和current journey共同验收。

## 范围内

* 迁移`MacroPanel`及`components/macro/**`全部existing UI presentation。
* 迁移`LibraryPanel`全部existing UI presentation。
* 删除workbench八个legacy CSS modules、aggregator import和10个existing component `<style>` block。
* 消费`.002`review交接的Macro/Library mixed-file selectors，删除其旧owner。
* 用theme-aware current oracle替换只冻结旧CSS file/cascade的`.009`test。
* 增加代表性theme、三viewport、nested flow和关键runtime/edit state回归。

## 范围外

* 修改MacroDefinitionV5、visual editor command、validation、Prepare、runner、Trace或LibraryItemV1 contract。
* 移动/合并panel、control、toolbar、section、tab或action；新增wrapper/component抽象。
* 修改文案、icon语义、keyboard flow、test id或field visibility。
* 以theme迁移名义重做Macro flow UX、Library navigation或saved-record state machine。
* 执行全项目最终CSS closeout；global剩余项归`.004`。

## 决策归属

AI可按formal inventory逐component迁移并修复明显visual问题。第三方component若要求重写DOM或降低current density，必须放弃该用法，不能扩大UI结构授权。
