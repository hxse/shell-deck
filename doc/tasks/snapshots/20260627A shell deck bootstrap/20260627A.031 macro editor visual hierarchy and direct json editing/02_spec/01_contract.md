# Contract

## 任务边界

本任务只改变 Macro/Text/tab chrome 的浏览器交互，不改变任何持久化 schema、HTTP/WebSocket contract、runner 执行语义或 alias validation。

交付停止线：

* 相邻 Macro body depth 的 guide 视觉上必须清楚可区分；同一 depth 必须稳定使用同一中等对比颜色。
* 每个 depth 只能产生一条竖线：body guide 与该 body 直属 node 的左边框必须同色、同为 2px 且横坐标重合；两层缩进必须只有两个唯一线位。
* 颜色不能成为唯一结构线索：node 底部 2px 渐隐实线 branch、缩进和 sibling whitespace 必须同时存在；node 不绘制上边线。
* `if/elif/else` branch wrapper 不得产生额外竖线或横向缩进；同一 semantic depth 的 `if body` 与 `for body` guide 横坐标必须一致。
* `Flow V2 Body` 是唯一常驻 body heading；不得渲染可点击的 Root/for/if/elif/else/control body summary，body 本身不得承担 collapse。
* 普通 Flow node 和 Parallel lane action 必须统一使用标题行右侧单组六个 icon-only controls，顺序固定为 Collapse/Move up/Move down/Add before/Add after/Remove；collapsed 状态必须显式标识且不得改变操作栏位置。
* message part、text-list item、extract filter 和 ELIF/ELSE branch 的通用 Up/Down/Remove 必须使用共享 icon-only control；具有具体创建/对象语义的 Add Text/Add inside/Add elif/Add else/Add item/Add filter/Add lane/Remove lane 等继续显示文字。
* IF family 的 branch action 必须与所属 IF/ELIF/ELSE label 同行；IF 不可删除，ELIF/ELSE 可删除，ELSE 唯一且存在时不得显示任何 `Add else`。
* 默认 idle 状态下，Macro header、runner dock、view tabs 必须分别保持单行布局；focused E2E 的默认 viewport/font 下 Macro header 实测为 39px，runner dock/view tabs 分别不得超过 40px/38px。
* workspace topbar 必须整栏缩小，Macro/Prompt/New/Settings 不得出现两套按钮高度或字号；terminal tab strip/tab 和 terminal meta 再按各自层级独立紧凑。
* Prompt/Trace 必须与 Macro 使用同一 12–14px 内容尺度；Prompt/Trace header 为 38px，不能继续使用旧 18px title 与 12px padding。
* 空 flow body 只能出现一个通用 `Add inside`；不得同时出现 `Add inside for/if/elif/else` 或 control `Add action`。Parallel lane popup 必须使用主 insertion overlay/palette contract。
* Macro 核心 typography 与 JSON code text 必须比辅助 chrome 更易读，放大时不得破坏 adaptive textarea 与 line-number 对齐。
* Text tab 行号、rename focus/caret/blur、JSON Save/Cancel/lock 的正反例都有自动化覆盖。
* JSON 解析或 schema/identity/server 保存失败不得改变当前 draft、server template 或 edit buffer。
* lock-sensitive 异步操作从请求发出到最后一次状态提交都必须持有 pending lock；pending 时 JSON Edit、整个 visual editor 与另一个 template mutation/Runner Start 不可进入。operation identity 必须包含 draft revision，任何 await 后 generation、config/template/revision identity 或 `jsonEditing` 不一致都必须丢弃旧 callback 的 UI/runner 提交。
* collapse state 必须以 template mount 和所属结构为生命周期；切换 template、删除 node/branch/lane 后不得把相同 id 的新结构显示为 collapsed。
* `just check`、`just build`、`just test-031`、`just test-unit` 和 `git diff --check` 为阻断 Gate。

Monaco/CodeMirror、JSON 高亮/格式化/自动补全、全应用离开确认、Text soft-wrap 行号布局、shell terminal 行号和其他 workbench 重设计都属于范围外；满足上述行为后停止扩张。

## 任务规范

### Macro Flow 层级与 sibling whitespace

每个递归 `NodeListEditor` 都有从 root body 开始的零基 `depth`。UI 使用固定四色 `#2786d2`、`#14977e`、`#ff8a00`、`#cf4d6f`，并在更深层级按该顺序循环；相邻 depth 不得使用同色。depth palette 不包含紫色，也不包含与首层 cyan-blue 难以区分的末层 cyan；第三层 orange 必须保持明亮、纯正，不得退回呈棕色的低饱和橙；guide opacity 为 `0.92`，不能再通过低 opacity 把颜色淡到难以辨认。

一个 body 的竖向 guide、该 body 内 node card 的左边框和 details marker 使用同一 depth color。guide 与 node 左边框都为 2px，并且 node 左边框必须通过布局补偿精确叠到 guide 横坐标；不得在一个 depth 内同时显示分离的 guide 与 accent。合并不得移动 node 正文的原有横坐标。

每个 node 只在底边从合并竖线起向右生成 branch，几何宽度覆盖至少 node 的 80%，并通过横向 mask 快速渐隐：0–18% 保持不透明，28% 为过渡中点，52% 起完全透明。底边 branch、竖向 guide 和 node 左边框全部为同色、同粗的 2px 连续实线；底边 background 不得包含 repeating gradient 或任何 dash/gap pattern。node 不得生成 top branch，原 neutral card top border 保持透明，因此视觉上没有任何上边线。card 其余 border 保持低对比 neutral，不使用大面积 depth 背景。if/elif/else body、for body 和 control action body 每递归一次增加一个 depth；同一 depth 跨不同 branch 保持同色。

同一个 body 内，从第二个 sibling node 开始保留至少 14px 的垂直留白；不得生成 sibling-only divider。bottom branch 属于每个 node 的树结构，不是 sibling separator；`::after` 不得用于 top branch。这些视觉元素都不写入 template，不影响 drag/insertion/move/collapse 行为。

`if`、`elif`、`else` 是同一个 `if` action 内的 branch slot，不是 action/node，也不消耗新的 tree depth。`.flow-branch-card` 必须是 flat section：`border-left-width`、`padding-left` 和 `margin-left` 都为 `0`，背景透明，不得再使用 neutral shadow rail 或整张嵌套 card。branch 之间使用至少 10px 垂直留白，并以紧凑 uppercase keyword badge 标识；branch 内 `NodeListEditor` 的彩色 guide 是唯一正式缩进。root 中相邻的 `if` 与 `for` 若其 body 都处于 depth 1，则两者 guide 的全局横坐标误差必须小于 0.5px。

每个 branch 的 keyword badge 与其 contextual actions 必须位于同一个 non-wrapping title row。左侧 label cluster 包含 keyword badge，并在折叠时显示共享 `Collapsed` badge；右侧 contextual action group 的第一项固定为独立 Collapse/Expand icon，随后才是 Add elif/Add else/Remove，不得把折叠按钮放在 label 旁边。标题行必须使用 `minmax(0, 1fr) auto` 两列，使 badge 出现前后右侧 action group 的 x/y 坐标不变。折叠只隐藏当前 branch 的 condition 和 recursive body，keyword 与整个 action group 保持可见，其他 IF/ELIF/ELSE branch 不得被连带折叠。collapsed toggle 必须复用普通 node/Parallel action 的 blue-tint active style，不得维护 branch 专用深蓝变体；badge + active toggle 共同区分状态。状态只存在于 editor UI，不写入 template；整个 editor state 以 `draft.id` keyed mount，切换 template 必须重置。ELIF 插入/删除和 IF node id 重命名后不得把 collapsed 状态错绑到另一个 branch；删除 ELIF/ELSE 时还必须递归清理其 body 内 node/branch collapse keys。

IF 行固定显示 `Add elif`，并在 ELSE 不存在时显示 `Add else`；IF 永远不显示 Remove。每个 ELIF 行固定显示 `Add elif`、条件式 `Add else` 和 `Remove`；点击其 `Add elif` 必须紧跟当前 branch 插入，不得统一 append 到最后。ELSE 行只显示 `Remove`，因为 ELSE 是终结 branch。一个 IF node 只能有一个 ELSE；一旦存在，IF 与所有 ELIF 行的 `Add else` 必须同时消失，删除 ELSE 后同时恢复。删除 ELIF/ELSE 必须确认并删除该 branch body；首个 IF branch 不可删除。该行为只改变 editor command，不改变持久化 schema。

`NodeListEditor` 只渲染 non-interactive `div.flow-block`；不得使用 `details/summary`，不得显示 node count 或 `Root body`、`for body`、`if body`、`elif body`、`else body`、`finish/break/continue action body` 标题。`data-flow-body-label` 可继续作为内部定位和 insertion summary 上下文；空 body 仍直接显示唯一 `Add inside`。`Flow V2 Body` 的静态 `h3` 是用户看到的唯一 body-level heading。

每个普通 Flow node 的编号标题（如 `1. for`）是唯一 node chrome。标题行右侧使用一个共用 `NodeActionControls` component，恰有六个独立的 24px icon-only button，顺序必须为 Collapse/Expand、Move up、Move down、Add before、Add after、Remove；Collapse 永远最左，Remove 永远最右，不得再拆成左右两组或把后三项渲染成文字。六项全部使用 15px round-stroke inline SVG，不得使用字符 glyph；通过 `title`/`aria-label` 暴露完整 action name，move 在 body 边界 disabled。每个 icon button 必须与同面板普通按钮共享独立白底、neutral border、4px radius 和 disabled shell；group 本身透明、零 border，不得绘制 segmented 外框或专用底色。button 的四边 padding 必须为 0，SVG 与 button 水平/垂直中心重合，不能被通用 title button padding 推偏。active collapse 使用项目已有 blue-border/blue-tint active 语言，keyboard focus 必须有可见 ring。

标题行使用稳定的左 title cluster 与右 action bar 两列布局。折叠后只保留标题行，并在左 cluster 中显示 `Collapsed` badge，同时显示 active toggle、depth-color tint card background/border 与 shadow 变化；badge 的出现不得改变右侧 action bar 的 x/y 坐标，不得只靠 chevron 方向或轻微灰底区分状态，collapse 状态不持久化。删除普通 node 时必须递归清理该 node 及其 descendants 的 node/branch collapse keys；node id rename 则迁移现有 key。Parallel lane action 必须复用同一个六按钮 component、顺序、编号、tooltip 和本地折叠行为；删除 lane 必须清理其全部 action collapse keys，删除单个 action 同理，之后复用相同 action id 必须默认展开。required final Output 不可移动/删除，保留专用 `Add before output`。

通用 item action 使用共享 `MacroIconButton`：Up、Down 和 Remove 分别使用与 node controls 相同的 15px rendered round-stroke SVG、24px button、零 padding、tooltip、`aria-label`、disabled/focus/hover shell。Remove 必须使用 24 viewBox 的 Lucide Trash2 风格，不得回退到紧缩的自绘方桶。该 contract 覆盖 node remove、普通与 Parallel send message parts、text-list items、extract filters，以及 ELIF/ELSE label row 的 Remove。所有这些按钮不得渲染可见的 `Up`、`Down`、`Remove` 文本。

图标化边界按语义而不是按单词前缀机械判断。`Add Text`、`Add Source`、`Add inside`、`Add elif`、`Add else`、`Add item`、`Add filter`、`Add lane`、`Remove lane`、`Add before output` 以及模板 New/Save/Duplicate/Import/Export/Delete 都保留文字，因为它们表达创建的具体类型、作用对象或业务命令。不得为了视觉一致性把这些动作改成无上下文图标。

### Macro chrome 与 editor density

默认无 waiting input 时，runner status、Start/Pause/Stop 和 Debug 必须在同一个 dock row；长 run id/status 使用单行 ellipsis，不得挤出控制按钮。Debug 展开后的 Refresh 使用相对 dock 的浮层，不增加固定 chrome 高度。出现 waiting input 时，其 prompt/editor/Send 仍在完整第二行，不得为了满足 idle 高度阈值压缩用户输入。

Editor/JSON/Trace tab 为 28px/12px；Start/Pause/Stop 为 28px/12px；Macro editor 内 branch/collection 的 Add Text 等文字 action 为至少 24px/12px，node action bar 的六个 icons 均为 24px。Macro section title、field label、node title、textarea 分别为 14px、12px、13px、13px，line-number gutter 与 textarea 同为 13px。JSON preview/editor 使用 14px、1.55 line-height 的等宽正文。template header、section、node card、message card 与 field 仍可小幅降低 padding/gap，但不得再用 9–11px 作为核心正文。terminal/Text 正文不缩小。

Macro template/Reset width header 在默认 Chromium font 下为 39px；其中 Reset width 为 26px/12px，template summary 保留 13px template name。Prompt 和 Trace panel 使用 38px header、14px title、13px panel body、12px actions。Prompt Reset width 和 Trace header actions 为 26px/12px；Prompt section 与 Trace section 使用 8px padding/6px gap，section title 为 14px。Trace 的 Run Log/AI Trace tabs 为 28px/12px，AI trace code 为 13px/1.5。Prompt 的原有默认宽度、可拖拽宽度和 300px body minimum 不改变；“与 Macro 一致”指 chrome/typography/spacing 层级，不把两种面板强制成同一物理宽度。

### Workspace 与 terminal chrome density

workspace topbar 总高为 36px，brand 保持单行横向信息。Macro/Prompt toggles、三个 New terminal buttons 和 Settings 全部为 28px/12px；toggle 可保留更宽的固定宽度，但不能更高或使用更大字号，switch track 随按钮等比例收紧。terminal tab strip 总高为 40px，单个 terminal tab 为 34px，alias 为 12px；index/kind/close 随 tab 等比例收紧。terminal pane 内 alias/id/status meta 总高为 36px，alias 为 11px，id/status 为 10px。shell xterm 和 Text editor 正文字号不变。

### Flow body insertion affordance

每个递归 body 由同一个 `NodeListEditor` 表达。`nodes.length === 0` 时，它只渲染一个文案为 `Add inside` 的占位按钮；该按钮根据 body path 插入第一个 child，并继承当前 body 的 loop-control 和 action-only 限制。以下专用入口不存在：`Add inside if`、`Add inside elif`、`Add inside else`、`Add inside for` 和 control node 的 `Add action`。

body 非空后不保留额外 container-level inside 按钮。继续增加 child 使用该 body 内现有 child node 的 Add before/Add after。普通 action node 的 Add before/Add after、Move、Collapse、Remove command 语义不改变，视觉统一为前述六图标 action bar；`Add elif` / `Add else` 属于 branch label 行的 IF 结构编辑动作，不属于重复 inside 入口。finish/break/continue 的空 action body 使用同一个 `Add inside`，但打开的 palette 只能包含 action，不能包含 flow control。

Parallel lane action list 保留 action 或 Output 上的 Add before/Add after 触发器。触发后必须渲染与主 flow 插入器相同的全屏 `macro-insertion-mode`、scrim 和 `floating-insertion-palette`，继承 workspace `anchored | center` setting；anchored 模式必须 clamp 在 viewport 内并避开 trigger，打开后 focus 第一个可用 action，Escape/scrim/Cancel 关闭并恢复 trigger focus。不得保留 Parallel 专用宽度、列数、阴影或 inline push-down 布局。

### Text tab 行号

只有 `backend = text` 的 Text tab 显示行号 gutter。行号按 `\n` 分割后的逻辑行计算，使用纯 1-based 十进制；空内容仍显示 `1`。

gutter 必须：

* 与 textarea 使用相同 line-height，并随 textarea 的 `scrollTop` 同步；
* `aria-hidden`、不可选择，不进入 copy、capture、WebSocket payload 或持久化正文；
* 宽度能容纳当前最大行号，至少保留三位数字空间；
* Text textarea 使用 `wrap="off"`，长行水平滚动，确保每个逻辑行恒占一个可编号 visual row。

### Tab rename

双击 shell/fake/real/text tab 后：

1. 当前 tab 变为 active，alias input 使用当前完整 alias 初始化；
2. input 挂载后的下一个 DOM tick 自动获得 focus；
3. selection start/end 都位于 alias 字符串末尾，不全选现有 alias；
4. 点击 input 外部触发现有 blur commit；合法且变化后的 alias发送一次 `rename_terminal`，相同值直接退出 rename；
5. Enter 继续提交，Escape 继续取消；非法或重复 alias 不发送，并保留现有错误提示和 rename input。

不增加第二套 click-away save 逻辑，提交真值仍是现有 `commitRename`。

### Macro JSON 读写与状态锁

进入 JSON tab 默认只读，显示当前 `draft` 的 pretty JSON。只读态提供 `Edit`、`Copy` 和 `Export`；不显示可输入 textarea。

点击 Edit 后：

* 创建独立 `jsonEditText` buffer，初值是进入时当前 draft 的 pretty JSON；
* 记录当前 template id 与 config id 作为不可变 edit identity；
* textarea 输入只更新 buffer，不更新 visual editor draft，也不发请求；
* 显示 Save、Cancel、Copy；Save/Cancel 结束编辑前始终保持 JSON view。

编辑期间禁止：

* 切换到 Editor 或 Trace；
* New、Select、Save visual draft、Duplicate、Import、Export、Delete 或编辑 template metadata；
* Runner Start。

Pause、Resume、Stop、Runner input 和 debug refresh 仍服务已经存在的 live run，不因 JSON 编辑被禁用。

New、Select、Save visual draft、Duplicate、Delete、Import、Export、initial config reload 与 Runner Start 都是 lock-sensitive operation。每次 operation 在发出第一个请求前同步增加 pending counter 并获取单调 generation，同时冻结 config id、selected template id、draft id 与 draft revision；所有 template controls、Runner Start、JSON Edit/Export 在 pending 时 disabled，整个 `MacroEditorShell` 还必须使用无默认 fieldset chrome 的 `disabled + inert` lock surface。`startJsonEdit()` 与各 callback 仍必须有 defensive guard。每个 `file.text()`/HTTP await 返回后，在读取后续 API client、替换 draft/list/selection、触发下载或发送 Runner Start 前，都必须复核：

1. operation generation 仍是当前 generation；
2. active config id、selected template id、draft id 和 draft revision 与 operation identity 一致；
3. `jsonEditing === false`。

任一复核失败只丢弃该旧 callback 的后续 UI/runner 动作，不得覆盖当前 state。`MacroEditorShell` 不得拥有 `$bindable` draft 或组件内 clone/write；Macro metadata 与所有 recursive editor mutation 必须进入 MacroPanel 的唯一 `updateDraft()`。该入口在 pending 时拒绝 mutation，并推进 draft revision 来防御绕过 DOM disabled/inert 的 stale/programmatic callback；正常 mutation 与所有 draft replacement 同样推进 revision。pending counter 在 `finally` 中释放；config reload 可用新 generation 使旧 config callback 失效，但 JSON Edit 与 visual editing 必须等所有 pending operation 释放后才能进入。Runner Start 的 save response 与随后 list response 都通过复核后，才允许发出 `/runner/start`；任一期间 revision 改变都必须在 start request 前终止。JSON Save 使用独立 edit-session generation，并在 save/list await 后核对 edit template/config identity；Cancel/config replacement 使旧 JSON response 失效。

Save 顺序固定为：

1. `JSON.parse(jsonEditText)`；
2. 使用当前 `validateMacroTemplate` 和 live `indexMap/terminals` 校验完整 current schema；
3. candidate `id` 必须等于 Edit 开始时的 template id，candidate `configId` 必须等于当前 config id；
4. 调用现有 template PUT/save；server 继续做最终 schema 和 config 校验；
5. 只有 server success 才用返回的 template 替换 draft、刷新列表并退出 edit mode。

任一步失败都在 JSON panel 内显示可读错误，保留 buffer 和 edit mode，且不修改原 draft。不得迁移、补字段、删除 unknown field 或自动转换旧 schema。

Cancel 无确认框地丢弃 buffer，恢复由未修改 draft 生成的只读 JSON，并解除所有 edit lock；Cancel 不发保存请求。

Copy 在只读态复制 preview，在 edit 态复制当前 buffer。

## 示例

### Flow 层级

```text
Root body       — depth 0 / 2px blue guide = node left border
  │ send A
  └──────── ··  — 2px solid bottom branch fades right
                 — sibling whitespace only
  │ if
    if body     — depth 1 / 2px teal guide = node left border
      │ send B
      └──────··  — solid bottom branch fades right

      │ for
        for body — depth 2 / orange guide
```

每个 depth 只有一个竖线横坐标；底部渐隐实线、缩进和 sibling whitespace 共同表达结构。关闭颜色后仍可从缩进、bottom branch 和留白识别 block。

`IF / ELIF / ELSE` label 本身不画竖线；上方条件和下方 action body 通过 label、留白与唯一的 child guide 分组。因此 `if` 不会比 `for` 多出一层视觉缩进，嵌套 `if` 每次也只增加一个真实 body depth。

### Rename

```text
double-click text_1
→ input value: "text_1"
→ document.activeElement is the input
→ selectionStart = selectionEnd = 6
type "_review", click workspace
→ rename_terminal("text_1_review")
```

### JSON 正例

```text
JSON → Edit → 修改 name → Save
parse ok → current schema ok → id/configId unchanged → server save ok
→ draft/list 更新 → 返回只读 JSON
```

### JSON 失败例

```text
JSON → Edit → 删除一个右花括号 → Save
→ Invalid JSON
→ textarea、buffer 和 Edit mode 保留
→ Editor/Trace 仍不能切换
→ 原 draft/server template 不变
```

```text
JSON → Edit → 把 id 改为 tmpl_other → Save
→ template id cannot change while editing JSON
→ 不创建新 template，不覆盖旧 template
```

## 测试

自动化必须覆盖：

* root/nested body 暴露 depth，depth 0/1 guide 分别为冻结的 blue/teal、2px、`0.92` opacity；
* root/nested body guide 与各自直属 node 的 2px 左边框位置误差小于 0.5px；两层 guide/node 共四个测点只能产生两个唯一横坐标；
* 每个 node 的 2px bottom branch 向右覆盖至少 80%，background 是连续 depth color、`background-image` 为 none、mask 包含 18%/28%/52% 快速 fade stops；`::after` content 为 none 且 card top border 透明；sibling margin 至少 14px且没有独立 divider；
* if/elif/else branch section 的 left border/padding/margin 为 0、背景透明，keyword label 为 uppercase badge；同层 if body/for body guide 横坐标误差小于 0.5px；
* `flow-block-summary` 不存在，flow block tag 为 `DIV`，可见编辑器不含 Root/if/elif/else/for/control body 标题；静态 `Flow V2 Body` heading 与空 body `Add inside` 保留；
* 普通 node 与 Parallel lane action 的 action bar 都恰有六个独立标准按钮 shell 的 SVG icon-only controls，顺序固定为 Collapse/Move up/Move down/Add before/Add after/Remove；title/aria-expanded、disabled boundary、collapsed class、`Collapsed` badge、blue-tint active toggle 与 depth-color tint card 可观测；折叠前后 action bar 坐标不变，24px button/15px SVG/零 padding 和中心对齐有 geometry 断言；
* message part、text-list item、extract filter、ELIF/ELSE 的通用 Up/Down/Remove 均为无可见文字的 SVG buttons，title/accessible name、顺序、disabled state 与实际 move/remove 行为有 E2E；Add Text/Add inside/Add elif/Add else 等语义按钮仍可见文字；
* node/item/branch Remove 使用 24 viewBox、五条 round-stroke path 的 Lucide Trash2；IF、ELIF、ELSE 各自有 Collapse/Expand button，aria-expanded、独立 hidden scope、label actions 可见和其他 branch 不受影响有 E2E；
* IF/ELIF/ELSE branch title 与 actions 同行；IF、ELIF、ELSE 的按钮矩阵分别为 Add elif/条件式 Add else、Add elif/条件式 Add else/Remove、Remove；contextual insert order、remove confirmation 和 Add else hide/restore 都有 command/E2E 覆盖；
* 默认 idle Macro chrome 的 header/runner/tabs 分别为 39px/不超过 40px/不超过 38px，view tab/runner/node action 分别为 28px/28px/至少 24px；Macro section/label/node/textarea/gutter 和 JSON text 字号均有 computed-style 断言；
* topbar、Macro/Prompt/New/Settings、tab strip/tab、terminal meta 分别为 36px、28px/12px、40px/34px、36px，并校验 alias/id 字号；
* Prompt/Trace header 为 38px，title/section/body/action 为 14/14/13/12px，Prompt Reset/Trace actions 为 26px，Trace tabs 为 28px；
* 空 if/elif/else/for/control body 只有直接 child `Add inside`，旧命名 inside/action test id 不存在；非空 for body 可从 child Add after 插入第二个节点，control body palette 保持 action-only；
* Parallel palette 与主 palette 的 computed position/width/padding/radius/shadow/action columns 相同，继承 placement mode，打开后首 action focused；
* Text 空内容显示行号 1，多行显示连续数字，scrollTop 同步，正文 payload 不含行号；
* tab 双击后 input 自动 focused、caret 在尾部；不先手动点击 input，直接编辑并 click-away 也会保存；
* JSON 默认只读；Edit 后 textarea 出现且 Editor/Trace、template mutation 和 Start 被锁；
* delayed Select response 期间 JSON Edit disabled，绕过 DOM disabled 直接触发 handler 也不能创建 edit buffer；response 释放后只提交目标 template；
* delayed Runner Start save response 期间 JSON Edit disabled，且 response 释放并通过 identity/generation 复核前不得发出 `/runner/start`；
* delayed visual Save response 期间 editor lock surface 与其 node fields 均 disabled/inert；强制绕过 DOM lock 触发 node field mutation 时，父层 guard 拒绝 draft 修改、推进 revision，旧 response 不得覆盖 draft；
* delayed Runner Start save response 期间执行相同强制 mutation 时，draft 保持原值且 `/runner/start` 始终为零；pending 释放后 editor 恢复可用；
* invalid JSON、invalid current schema、id mismatch、configId mismatch 均保持 buffer/draft；
* valid JSON Save 持久化并退出 edit，Cancel 丢弃修改并解除 lock；
* 两个不同 template 复用相同 node id 时，前一个 template 的 collapse 不得传给后一个；删除 collapsed node 后创建同 id node、删除 collapsed lane action 所在 lane 后重建同 id action，都必须默认展开；
* production build 中无 dev/test-only schema 分支。

Gate 命令：

```text
just check
just build
just test-031
just test-unit
git diff --check
```
