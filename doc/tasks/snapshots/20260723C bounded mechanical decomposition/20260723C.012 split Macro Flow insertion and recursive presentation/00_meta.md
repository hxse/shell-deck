# 20260723C.012 Split Macro Flow Insertion and Recursive Presentation

## 任务概括

`MacroFlowNodeList.svelte`当前431行。component已把tree mutation和palette lifecycle抽出，但script仍直接拥有anchor/open/settle/cancel/insert/move状态与命令，同时渲染递归Flow markup。本task把insertion controller抽出，markup和recursive snippet原地不动。

## 正式 task 级别及定级原因

三星任务。insertion anchor跨nested body/If/For/control path，draft变化时需要失效；floating palette还必须保持exact trigger focus、Escape和viewport clamp。拆分不能改变DOM或创建第二套placement算法。

## 范围内

* 新建stateful Macro Flow insertion controller。
* controller唯一拥有当前component实例的insertion rune state与commands。
* 继续复用`MacroInsertionPaletteLifecycle`和`macroFlowTreeController`。
* component保留props、recursive render、terminal/artifact adapters与exact markup。

## 范围外

* 不componentize/move recursive DOM，不改class/test id/control order。
* 不改Flow schema/default/validation或Parallel component。
* 不复制draft或新增mutation gateway。
