# Problem Context

`.016` 已经把 macro language 收敛到 Flow V2：actions 与 flow controls 分开，控制流采用 Py-like `if/elif/else/for/break/continue/finish`，并删除旧的 `branch/goto/parse/sleep/parallel_all` 主路径。

但当前 node editor 的创建入口仍然偏“全局 palette”心智：用户先看一个 Actions/Flow 侧栏，再思考要把节点插到哪里。这个模型有几个问题：

* 插入位置不够明确。用户想“插到这个节点前面 / 后面 / if 内部 / for 内部”时，必须通过全局按钮和后续移动来完成，容易误插。
* Actions 与 Flow 的视觉层级不够贴近模板结构。控制流虽然语义上是 block-tree，但 UI 仍容易被看成一串按钮和配置块。
* 常驻右侧 Actions/Flow 栏占用编辑器空间，且容易和 Run controls、Template selector、Trace 等 workbench chrome 混在一起。
* 未来如果继续给全局 palette 加功能，会重新扩大 `.015` 已经拆出来的组件边界债务。

用户期望的是：节点本身提供插入和移动入口；点击插入位置后，宏编辑区进入明确的 insertion mode，临时选择要插入的 action/flow；选择完成后恢复正常编辑。控制流节点的内部插入也必须显式，例如 `Add inside if`、`Add inside elif`、`Add inside else`、`Add inside for`。

本任务主要是 UI/interaction redesign，不重新设计 action/message/capture 语义。但在实现节点局部插入时暴露出两个 Flow V2 控制流缺口，必须在本任务内收口：`for` 需要明确支持“固定次数”和“持续循环直到 break/finish/stop”；`finish` / `break` / `continue` 需要能在结束控制流前执行少量普通 action，例如先 `send_line` 再 `finish`。这些扩展只作用于控制流节点，不恢复旧 v1 flow，也不引入新的 action type。
