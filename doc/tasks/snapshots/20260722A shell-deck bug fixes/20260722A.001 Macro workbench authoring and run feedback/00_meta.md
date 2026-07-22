# 20260722A.001 Macro Workbench Authoring And Run Feedback

## 任务概括

修复一批位于同一Macro workbench authoring/runtime反馈面的实际问题：For text-list只能在列表末尾Add；运行阶段与当前node不醒目；active run期间visual/JSON UI仍显得可编辑；App通知只呈现一次；Parallel的`source:none`被“required Output”UI掩盖；loop template启用后仍显示冗余source提示且token按钮过大。

## 正式 task 级别及定级原因

三星任务。

改动包含strict MacroDefinitionV5子协议、Room WebSocket notification payload、browser timer lifecycle、runner状态投影和多层Svelte editor控件。实现必须端到端一致并覆盖observer/reconnect/clear等负向边界，不能只做表面CSS。

## 范围内

* 每个For text-list item提供icon-only insert above/insert below。
* active Room run期间锁定Macro authoring controls，并以统一、明显的read-only surface说明原因。
* Run dock突出status与current stage；visual flow对匹配current node提供边框高亮。
* App notify channel保存并执行重复次数与间隔。
* 在不改Parallel schema/runtime的前提下，把既有`output.source:{kind:"none"}`呈现为明确的“不收集lane text”选项。
* loop template启用后只显示三个紧凑token插入按钮，移除`Available...from...`提示。

## 范围外

* 不增加Parallel action type、不删除final Output node、不改变`merged_text`runtime算法。
* 不重复System notification或Telegram delivery。
* 不改变runner并发模型、active run frozen definition、Trace/event schema或terminal structure lock。
* 不重做Macro整体布局、颜色系统或其它编辑器控件。
* 不接受缺少新App repeat字段的旧Notify shape，不增加compatibility default。

## 决策归属

人工已拍板上述用户体验方向与`.001`归属。AI可确定有界数值、最小DOM/CSS实现和回归覆盖；任何超出这些问题的schema或产品能力另开任务。
