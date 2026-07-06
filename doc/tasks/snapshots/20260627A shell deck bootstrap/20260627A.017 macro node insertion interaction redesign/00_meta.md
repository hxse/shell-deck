# 20260627A.017 Macro Node Insertion Interaction Redesign

* 父任务：`20260627A shell deck bootstrap`
* 状态：implementation-landed；automated gate passed
* 类型：post-v0 macro-editor-ux-design
* 前置任务：`20260627A.016 macro action message flow redesign`
* 目标：在 Flow V2 action/message 语义收敛后，重新设计 Macro node editor 的插入交互：每个节点自身提供明确的 Add Before / Add After / Add Inside 入口，动作选择改为临时浮动插入面板，删除常驻右侧 Actions/Flow 栏，并用 Py-like 竖线/缩进强化嵌套关系；同时补齐本轮交互暴露出的控制流和编辑器缺口：`for` 支持 count / forever 两种模式，`finish` / `break` / `continue` 支持 action-only body，`extract_text.onEmpty` 支持 `continue`，Terminal 控件合并显示 index/alias/id 并提供 hover 完整映射。
* 非目标：不新增或删除 action type；不恢复旧 v1 flow；不做 drag-and-drop 排序；不重新设计 Template selector、Prompt panel、Trace tab、terminal tabs。
* 本任务追加收敛：`send_line.message.parts` 可以为空，artifact source 的 `none` 不再写空 stepId；`extract_text.select` 移除 `first/last` 并支持负数 `index/range`；默认 seed 为两个 shell 加一个 text slot。
