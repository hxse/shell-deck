# Contract

## Scope

范围内：

* Macro node editor 每个节点提供局部 node menu：`Add before`、`Add after`、`Remove`、`Move up`、`Move down`。
* 控制流节点额外提供内部插入入口：
  * `if` group：`Add inside if`、`Add elif`、`Add inside elif`、`Add else`、`Add inside else`。
  * `for` node：`Add inside for`。
* 删除常驻右侧 Actions/Flow palette 的目标设计；action/flow 选择改为临时 floating insertion palette。
* `Start` / merged `Pause`/`Resume` / `Stop` runner controls 不进入 insertion palette，保持在 Macro 顶部 run dock / status bar。
* Flow V2 editor 用 Py-like block visual：缩进、左侧竖向 scope guide、branch label、body boundary 必须清楚。
* 插入行为基于明确位置，不再依赖“先创建到末尾再移动”的主路径。
* 新增 reducer / command 层，把 UI 点击转换成 path-based insertion command，避免 Svelte 组件直接手写深层数组 mutation。
* `for` 控制流支持两种 range：固定次数 `count` 和持续循环 `forever`。`forever` 只由 `break` / `finish` / stop / fail 退出。
* `finish` / `break` / `continue` 支持 action-only body：允许在控制流生效前执行 `send_line` / `input_line` / `wait` / `capture-source` / `extract_text` / `parallel_send_capture` 等普通 action；不允许插入 `if` / `for` / `finish` / `break` / `continue` 等 flow node。
* `extract_text.onEmpty` 支持 `continue`，用于在循环内空结果时跳过本轮后续 action。
* 空 macro body 是合法 draft/template，`New Template` 默认不再预置空 `send_line`。
* `send_line` / `input_line` message parts 可以为空；artifact message part 可以显式无 source，表示 `none`，runner 渲染为空字符串。
* `extract_text.select` 收口为 `all` / `index` / `range`，其中 `index` / `range` 支持负数，从末尾倒数选择文本片段。
* Terminal target 控件必须一行合并显示同一 terminal 的 `index` / `alias` / `id`，并提供 hover 完整信息；不得再把 alias/id/index 展开成三组重复选项。

范围外：

* 不新增或删除 action type。
* 不改变 runner 状态机、run log、capture source 种类或 send/input message flow 的总体模型；本任务只正式收口上方列出的 Flow V2 editor 友好语义。
* 不做 drag-and-drop 排序。
* 不做 schemaVersion 迁移。
* 不重新设计 Template selector、Prompt panel、Trace tab、terminal tabs。

## Recommended Interaction Model

推荐方案：使用 floating insertion palette，而不是继续保留常驻右侧 Actions/Flow 栏。

流程：

1. 用户在某个节点菜单点击插入入口，例如 `Add after` 或 `Add inside if`。
2. Editor 进入 `insertion mode`：
   * 当前插入锚点高亮。
   * Macro editor 其余区域轻微 dim，但仍可滚动查看上下文。
   * Macro 顶栏提供 insertion palette placement 开关：`near` / `center`。默认 `near`。
   * `near` 模式下，浮动插入面板出现在触发按钮附近：按钮在屏幕上半边时显示在按钮下方，按钮在屏幕下半边时显示在按钮上方；不得跑出 viewport。
   * `center` 模式下，浮动插入面板显示在屏幕中央。
3. 用户在浮动面板选择要插入的新节点类型，或从 `Move existing` 下拉选择已有 node id。
4. 如果选择新节点类型，系统按锚点插入默认节点；如果选择已有 node id，系统把该节点移动到当前锚点。完成后退出 `insertion mode`，新/移动后的节点位置标记 draft dirty。
5. 用户按 `Esc`、点击 Cancel 或点击 editor 空白处时取消，模板不产生任何变化。

不采用的方案：点击插入位置后让全局右侧 palette 继续承担选择动作。理由：它会保留常驻栏布局压力，也会让“当前到底插到哪里”不如锚点 popover 明确。

## Node Menu Contract

普通 action node 菜单：

* `Add before`
* `Add after`
* `Move up`
* `Move down`
* `Remove`

`Move up` / `Move down` 只在同一个 body array 内移动；不得跨出当前 `if` branch 或 `for` body。

`Remove` 必须有确认或 undo-safe 交互。V0 推荐沿用现有确认弹窗，不引入复杂 undo stack。

控制流节点菜单：

* `if` group：
  * 普通菜单项：`Add before`、`Add after`、`Move up`、`Move down`、`Remove`。
  * 内部菜单项：`Add inside if`。
  * 每个 `elif` branch：`Add inside elif`。
  * 如果没有 `elif`：提供 `Add elif`。
  * 如果没有 `else`：提供 `Add else`。
  * 如果已有 `else`：提供 `Add inside else`。
* `for` node：
  * 普通菜单项同上。
  * 内部菜单项：`Add inside for`。
  * Range selector 支持 `count` 和 `forever`。`count` 显示次数输入；`forever` 不显示次数输入。
* `finish` / `break` / `continue` node：
  * 普通菜单项同上。
  * 内部菜单项：`Add action`。
  * `Add action` 只打开 Actions section；Flow section 必须隐藏。
  * `Move existing` 在 action-only body 中只允许选择普通 action node；不得把 `if`、`for`、`finish`、`break`、`continue` 移入其中。

`elif` / `else` 不是 root-level flow node，不出现在普通 floating palette 的 root 选择里。它们只能从 `if` group 的局部菜单创建。

## Insertion Anchor Model

UI 不把插入位置保存进 macro template；插入位置只存在于 editor state。

建议内部 command：

```ts
type InsertionAnchor =
  | { kind: 'before'; parentPath: BodyPath; index: number }
  | { kind: 'after'; parentPath: BodyPath; index: number }
  | { kind: 'inside'; parentPath: BodyPath; index: number; slot: 'if' | 'elif' | 'else' | 'for' | 'control'; branchId?: string };
```

`BodyPath` 表示从 `template.body` 到目标 body array 的结构化路径，不使用字符串表达式或 DOM id 推断。

插入规则：

* `before`：插入到同一 body 的 `index`。
* `after`：插入到同一 body 的 `index + 1`。
* `inside if`：插入到 if primary branch body 末尾。
* `inside elif`：插入到指定 elif branch body 末尾。
* `inside else`：插入到 else body 末尾。
* `inside for`：插入到 for body 末尾。
* `inside control`：插入到 `finish` / `break` / `continue` 的 action-only body 末尾。

所有插入都必须生成唯一 node id；不得复用固定 id，例如 `finish_elif` / `finish_else`。

## Floating Palette Contents

Floating palette 分为三个 section，不再是常驻 editor 右栏：

Actions：

* `send_line`
* `input_line`
* `wait`
* `capture-source`
* `extract_text`
* `parallel_send_capture`

Flow：

* `if`
* `for`
* `finish`
* `break` / `continue` 仅当 anchor 位于 `for` body 或其嵌套 body 内时显示。

当 anchor 位于 `finish` / `break` / `continue` 的 action-only body 时，palette 只显示 Actions section 和可移动的普通 action node，不显示 Flow section。

Palette 必须展示当前插入位置摘要，例如：

* `Insert after: capture_worker`
* `Insert inside if: check_review`
* `Insert inside for: retry_loop`

Palette 不显示 runner controls，不显示 Template CRUD，不显示 JSON/Trace 切换。

## Visual Nesting Contract

Flow V2 editor 必须让控制流层级在视觉上成立：

* 每个 body 有左侧竖向 scope guide，类似 Python indentation guide。
* `if` / `elif` / `else` branch 使用同一 group container，但 branch body 各自有清楚 label。
* `for` body 与 parent body 缩进不同，且 guide 从 header 延伸到 body 尾部。
* Empty body 显示一个轻量 insertion affordance，例如 `Add inside if`，但不强迫用户去全局 palette 找按钮。
* 折叠状态不能隐藏当前 insertion anchor；如果用户在折叠 branch 上点 `Add inside`，应自动展开目标 branch。
* 竖线只表达结构，不作为装饰线抢视觉；选中/hover/insertion anchor 的状态优先级更高。

## Control Flow Semantics

`for` range schema：

```json
{ "kind": "count", "count": 3 }
```

或：

```json
{ "kind": "forever" }
```

兼容读取 `{ "count": 3 }` 这种 `.016` 形态，但新 UI 保存时应写 `kind: "count"`。`forever` 循环不允许同时保存 `count` 字段。

`finish` / `break` / `continue` action-only body schema：

```json
{
  "id": "finish_after_notify",
  "type": "finish",
  "body": [
    { "id": "send_before_finish", "type": "send_line", "terminal": { "kind": "index", "value": 1 }, "message": { "parts": [{ "kind": "text", "text": "done" }] } }
  ]
}
```

执行语义：先按顺序执行 body 内普通 action；body 成功完成后，当前 node 才触发 `finish` / `break` / `continue`。如果 body 内 action pause/fail/stop，则控制流终止动作不得提前生效。

校验语义：control terminal body 只能包含普通 action node，不能包含任何 flow node；artifact source 仍按 visible predecessor scope 校验。

`extract_text.onEmpty` 支持：

* `pause`：暂停 run，等待用户处理。
* `continue`：返回 loop `continue` 控制信号；在 `for` 内跳过本轮后续 action，在 loop 外按 escaped control 暂停。
* `fail`：失败并停止 run。
* `finish`：结束当前 macro run。

## Terminal Target Display

Terminal select 控件显示一行一个 live terminal：

```text
#1 | alias:reviewer | id:term_xxxxx
```

控件和 option 的 hover/title 必须包含完整三元组：index、alias、id。用户选择某一行后，UI 可以保存为稳定 `id` target；已经存在的 `alias` 或 `index` target 必须通过当前 `indexMap` 解析到同一行显示。terminal tab reorder 或 alias rename 后，后端广播新的 `indexMap`，Macro editor 下次渲染必须自动展示最新映射，不要求用户手动同步模板里的三种表达方式。

## Workbench Chrome Boundary

`.017` 只改 Macro editor 内部插入交互，不改 `.014/.015` 已冻结的 workbench chrome：

* Macro title / Template selector / Template CRUD 位置不变。
* Editor / JSON / Trace 仍是 Macro 顶层 tabs。
* Run dock / status bar 仍在 editor 上方；`Start`、merged `Pause`/`Resume`、`Stop` 不出现在 floating insertion palette。
* Prompt panel 不受影响。
* Terminal tabs 不受影响。

## State and Failure Semantics

* 进入 insertion mode 不改变 template draft。
* 取消 insertion mode 不改变 template draft。
* 插入节点后才改变 template draft，并立即触发 validation。
* 如果 default node 生成后 validation failed，UI 必须留在新节点上并展示 validation issue，不得静默丢弃。
* Anchor validity check 必须是只读操作；缺失的 else body 或 control action body 不得仅因为校验而被创建。
* 如果 anchor 对应节点在多 tab 同步中被删除，floating palette 自动关闭并提示 stale insertion anchor。
* 保存仍走现有 template save/import/export 流程。

## Accessibility and Keyboard

* `Esc` 取消 insertion mode。
* `Enter` / click 选择 palette item。
* Node menu、floating palette、remove confirm 必须可键盘聚焦。
* Palette 打开时焦点进入 palette；关闭后焦点回到触发按钮或新节点。
* Palette 不得遮挡当前锚点的 node header；小宽度下可停靠到 editor 顶部。

## Testing Contract

必须覆盖：

* 从 root action node `Add before` / `Add after` 插入 action。
* 从 `if` group `Add inside if` 插入 action。
* 新增 `elif`，再 `Add inside elif` 插入 action。
* 新增 `else`，再 `Add inside else` 插入 action。
* 从 `for` node `Add inside for` 插入 action，并确认 `break` / `continue` 只在 for scope palette 可见。
* `for` 可从 UI 切换 `count` / `forever`；JSON 中 `forever` 不保存 count。
* `extract_text.onEmpty` 下拉包含 `continue`，schema 和 runner 均支持。
* Terminal 下拉每个 terminal 只显示一行，行内同时包含 index、alias、id，hover title 显示完整映射。
* `finish` / `break` / `continue` 可以插入普通 action；对应 palette 不显示 flow node，`Move existing` 也不得移动 flow node 进去。
* Runner 执行 `finish` / `break` / `continue` 前必须先执行其 action-only body。
* Runner 执行 `for.forever` 时必须能由 `break` 退出，不得吞掉 stop/pause/fail。
* `Move up` / `Move down` 不跨 body。
* `Remove` 有确认，取消不改变 draft。
* `Esc` 关闭 floating palette 且不改变 JSON。
* `Move existing` 从浮窗选择已有 node id 后，节点被移动到当前 anchor；不得把父节点移动进自己的 descendant body。
* 插入后 JSON 中节点出现在正确 body path。
* Editor 视觉 guide 在嵌套 if/for 中存在，且没有横向溢出。
* Runner controls 不在 insertion palette 内；`Pause` 和 `Resume` 必须合并为同一个状态感知按钮，`paused`/`waiting`/`interrupted` 时显示并执行 `Resume`；`waiting_user_input` 时显示并执行 `Pause`，实际完成输入只能通过 input box 的 `Send`；`running` 时显示并执行 `Pause`；`idle`/`completed`/`failed`/`stopped` 时按钮禁用。
* 顶栏 placement 开关默认 `near`，可切换到 `center`；Playwright 覆盖两种模式。
* near palette 打开后必须按实际尺寸 clamp 到 viewport 内，测试断言 x/y 和 x+width/y+height 均不越界，且 palette bounding box 不覆盖触发按钮或 node header。
* 单测覆盖 readonly anchor validation：缺失 else 或 control body 时 isInsertionAnchorValid 返回 false 且不 mutate draft。
* Palette 打开后焦点进入第一个可操作控件；`Esc` / Cancel 后焦点回到触发按钮。
* Anchor 对应节点被远端同步删除或替换时，palette 自动关闭并显示 stale insertion anchor 提示。
