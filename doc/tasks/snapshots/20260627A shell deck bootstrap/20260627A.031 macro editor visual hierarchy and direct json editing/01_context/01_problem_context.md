# Problem Context

## 使用场景与问题

Macro Flow 已经用接近 Python 的竖线和缩进表达 block tree，但所有 guide 接近同一种浅灰色，同级 node card 之间也只有普通 gap。宏一长，用户很难快速判断“这个节点属于哪一层”和“这里是否已经进入下一个同级块”。

第一轮用高饱和六色、3px body guide、4px node accent 和 2px gradient sibling divider 强化层级后，结构虽然明显，但视觉重量过高，像连续强调色条，不像 IDE 中克制的 indent guide；runner 状态、控制按钮和 Debug 仍各占一行，header 与 view tabs 也偏高，在 side panel 里挤压了真正的节点正文。用户复测要求在同一个 `.031` task 内继续收口。

第二轮复测进一步明确：缩进树线应在每个 node 的底边向右延伸并逐渐淡出，不在 node 上边生成横线；有了这条 bottom branch 后，sibling 专用 divider 应完全取消，只保留块间空白。尺寸也不能整体一起缩：Editor/JSON/Trace、Start/Pause/Stop 和 node action 需要比第二轮初值稍大，而 New fake/shell/text、terminal tab 和 terminal alias/id meta 可以单独缩小。

第三轮复测指出顶部栏仍被错误拆成两套尺度：New fake/shell/text 很小，Macro/Prompt/Settings 很大，而且 topbar 自身没有同步变矮；同时 Macro 面板核心文字整体过小，JSON 文本尤其不适合长时间阅读。最终要求是 topbar 整栏统一缩小，而 Macro 内容与 JSON 反向放大。

第四轮复测指出前一轮又把固定 chrome 压得略过头：workspace 的 Macro/Prompt 栏和 Macro template/Reset width 栏需要各回调一档；Prompt 与 Trace 仍沿用更松散的旧 header/section 尺度，看起来不像同一个 Macro workbench。真实 DOM 中还存在重复的结构入口：空 `for body` 同时显示 `Add inside for` 和通用 `Add inside`，if/elif/else 与 control action body 同样重复。Parallel lane 的 Add before popup 虽然使用了 palette class，却仍作为 inline section 撑开 lane，并保留 420px/四列专用样式，与主插入弹窗的 overlay、定位、focus 和 scrim 行为不一致。

第五轮复测聚焦 tree line 本身：原设计每层同时存在 1px body guide 和 2px node 左边框，两层缩进因此会被视觉识别为四条竖线；原低饱和 palette 叠加 `0.78` opacity 后对比不足。底边 branch 虽然渐隐，但只是 1px continuous gradient，不够明显，也不是真正的虚线。用户要求每个缩进只对应一条线，竖边框直接与 guide 合并；底边仍保留渐变虚线，但与竖线同粗。

第六轮复测保留已经合并的单竖线结构，但明确否定灰暗 muted palette 和底部 dash/gap pattern。最终要求缩进 guide 使用更清晰的 IDE accent 色，底部 branch 改为连续实线，同时保留向右渐隐和 2px 同粗关系。

第七轮复测要求在 node 上边补回结构 branch，但不恢复 continuous top border：上边使用与竖线同粗、同色、向右渐隐的虚线；底边继续保持渐隐实线。top branch 属于每个 node，不是 sibling divider。

第八轮澄清指出“类似下边框”指的是相同的连续实线，而不是虚线。最终竖向缩进线、node 左边框、上边 branch 和下边 branch 全部统一为 2px continuous solid；上下 branch 只通过 mask 渐隐，不使用任何 dash/gap pattern。

第九轮视觉复测最终取消 node 上边线：top branch 伪元素直接删除，neutral card top border 继续透明。树结构只保留竖向 guide、node 左边框和底部渐隐实线，减少不必要的视觉包围。

第十轮复测发现 `if/elif/else` wrapper 自身的 neutral border-left/padding 看起来像一层阴影缩进，而 branch 内 action body 又绘制正式彩色 guide，导致 `if` 相比 `for` 多出一个不存在的视觉 depth。最终把 branch wrapper 定义为 flat section：删除 border、left padding、margin-left 和背景 rail，只用 keyword badge 与留白分组；child body guide 继续作为唯一正式缩进。

第十一轮复测指出 body summary 本身仍重复且交互不统一：静态 `Flow V2 Body` 下又有可折叠 `Root body`，for/if/elif/else/control 也各自显示可折叠 `xx body`，同时 node title 还有文字版 Collapse/Move up/Move down。最终删除全部 body summary，让 body 只承担递归布局；折叠回到每个编号 node 标题行，并把 Collapse/Move up/Move down 统一为有 tooltip 的 icon group，Add before/Add after/Remove 单独作为 text group。相同 contract 同步用于 Parallel lane action。底部 branch 的 fade stop 从原 32%/62%/100% 收短为 18%/28%/52%。

第十二轮复测指出字符形式的 `▸/▾/↑/↓` 方按钮视觉粗糙，而且 collapsed card 仅有轻微灰底，状态辨识仍不足。最终 structural controls 提取为 Flow/Parallel 共用的 segmented toolbar，三个按钮全部使用 15px round-stroke SVG；collapsed 状态使用 depth-color 实心 toggle、`Collapsed` badge、depth-color tint 背景与边框，不再只依赖一个方向字符传达状态。

第十三轮复测指出 segmented toolbar 又形成了 Macro 里独有的按钮画风，与 Add/Remove 等标准独立按钮不协调；同时 `Add elif` / `Add else` 悬在全部 branch 下方，无法从位置判断操作属于 IF 还是某个 ELIF，ELIF/ELSE 也缺少删除自身的入口。最终保留 shared SVG component，但每个 icon 恢复为与 Macro 普通按钮相同的独立白底、neutral border、4px radius 和 blue-tint active state。branch 操作全部回到 label 行：IF 为 Add elif/条件式 Add else，ELIF 为 Add elif/条件式 Add else/Remove，ELSE 只有 Remove。

第十四轮复测要求 Add before、Add after、Remove 也图标化，并把原左右两组 controls 合并到标题行右侧。最终 node action bar 固定为六个 icon-only button：Collapse、Move up、Move down、Add before、Add after、Remove；Collapse 永远最左，Remove 永远最右。`Collapsed` badge 属于左侧 title cluster，标题行使用 `minmax(0, 1fr) auto` 两列，因此 badge 出现不得改变右侧 action bar 坐标。排查同时发现通用 `.step-title button` 的 padding 规则以更高 specificity 覆盖 icon padding，造成 SVG 视觉偏右；最终以更精确 selector 固定 24px button、零 padding 和 15px SVG，并用浏览器几何测量冻结中心点。

第十五轮复测发现 Send message part 内仍使用文字 `Up` / `Down` / `Remove`，相同残留还存在于 text-list item、extract filter 和 ELIF/ELSE branch。最终把“通用结构操作”与“具体语义操作”作为统一边界：裸 Up/Down/Remove 使用 icon-only button；Add Text、Add inside、Add elif/Add else、Add item、Add filter、Add lane/Remove lane 和模板级命令继续显示文字。这样既统一高频排序/删除 chrome，也不会把需要用户理解对象和结果的业务动作压缩成含糊图标。

第十六轮复测要求改善垃圾桶造型，并让 IF family 的每个 branch 能独立折叠。最终 Remove 改为 24 viewBox 的 Lucide Trash2 轮廓，在现有 15px icon shell 内保留更舒展的桶盖、桶身和两条短竖线。IF/ELIF/ELSE 左侧显示 keyword badge，并在折叠时显示与 node 相同的 `Collapsed` badge；右侧 contextual action group 以 Collapse/Expand icon 开头，折叠按钮紧邻并位于 Add elif/Add else/Remove 之前。折叠只隐藏该 branch 的 condition 和 recursive body，label 与整个 action group 继续可操作，其他 branches 不受影响；collapsed button 复用 node/Parallel action 的浅蓝 active state，不再维护 branch 专用深蓝变体。标题行使用固定两列，badge 出现不会推动 actions。折叠状态是 editor-local UI state；ELIF 插入/删除会迁移后续索引状态，IF node id 重命名会同步迁移 key，不进入宏 schema。

Text tab 是用户直接编写或收集多行文本的面板，却没有行号。定位 capture 输入、逐行核对结果或讨论某一行时，只能靠目测。

tab rename 已经在 input blur 时提交，但双击后动态出现的 input 没有自动获得焦点。第一次点击别处时，焦点实际仍停在原 tab 上，因此不会触发 input blur；用户必须先额外点击输入框，之后 click-away 才能提交。

Macro JSON 当前只是 `pre` 预览。visual editor 与 JSON tab 本来就是互斥视图，用户希望在需要批量或精确修改时直接编辑 JSON，同时不能因为 parse/schema 错误或切换视图而静默丢失输入。

Close Gate 复审进一步发现两个 editor state 生命周期缺口。第一，JSON lock 只在 callback 起点检查；Select/New/Save/Duplicate/Delete/Import/Runner Start 若先发出请求，用户可在 response 返回前进入 JSON Edit，随后旧 callback 仍替换 draft 或继续启动 runner。第二，collapse arrays 只按 node/action id 存活，切换 template、删除 node 或删除 Parallel lane 后没有完整回收；默认 id 被自然复用时，新节点会继承旧 template/旧节点的折叠状态。两项都不是 schema 问题，应由 MacroPanel 的异步提交令牌和 editor-local state ownership 从根上收口。

再次复审发现 pending lock 仍没有覆盖 visual editor：`operationPending` 只传给 template chrome 和 JSON view，`MacroEditorShell` 继续通过 `bind:draft` 和组件内 clone/write 修改同 id draft，而 operation identity 只比较 draft id。用户在 delayed Save/Start 期间编辑节点时，旧 response 因 id 未变仍会提交，导致新编辑被覆盖，Start 还会运行请求发出时的旧快照。最终必须移除 child-owned draft 写入，把 revision 纳入 identity，并让 pending editor 在 DOM 与 callback 两层都不可写。

## 方案取舍

Flow 层级不使用大面积不同背景色，因为多层嵌套会产生过强色块并干扰字段阅读。最终采用不含紫色的四色清晰 IDE accent depth palette（cyan-blue/teal/orange/rose），guide opacity 为 `0.92`。第一层从纯蓝向青色偏移；第三层使用明亮、纯正的 orange `#ff8a00`，避免低饱和橙呈现棕色；原末层 cyan 因深层嵌套时与首层 cyan-blue 难以区分而删除。每层 body guide 与 node 左边框统一为 2px，node 用负 margin 把左边框移动到 guide 的同一横坐标，再补偿内部 padding，所以正文位置不变且一层只出现一条竖线。每个 node 只从统一竖线向右拉出同为 2px 的底部连续实线 branch并叠加横向 mask fade，没有 top branch 或 dash/gap。连续 sibling 只保留 14px 空白，不渲染独立 divider。

branch slot 不参与 depth 计算。`if/elif/else` 的 section shell 使用透明背景和零 border/padding-left/margin-left，紧凑 uppercase badge 承担分支命名；递归 `NodeListEditor` 仍以 `depth + 1` 绘制唯一 child guide。因此同层 if body 与 for body 的 guide 对齐，嵌套结构只随真实 action body 增长。

body container 不再是可交互 `details`，而是只保留 data label 的 `div`；用户只看到静态 `Flow V2 Body`、IF/ELIF/ELSE keyword 和实际 nodes。普通 node 与 Parallel lane action 复用同一个六按钮 SVG action component；全部按钮使用与其他 Macro action 相同的独立 button shell，并合并为标题行右侧唯一 action bar。collapse 只影响当前 node 的编辑内容，不再与 body collapse 叠加；左侧状态 badge 与右侧操作栏由 grid 分列隔离。collapsed card 同时显示 blue-tint active toggle、状态 badge 和 depth-color tint card，避免把颜色或 chevron 当成唯一状态线索。Output 因为是 Parallel lane 的 required final node，继续保留专用且不可移动的 chrome。

结构操作按 ownership 全面核对后固定为一套规则：node-level collapse/move/insert/remove 在 node title；IF family branch insert/remove 在 branch label；text-list/message part/filter 等 collection 的 Add 在 collection header，item reorder/remove 在 item header；空 body 的首个 child 仍由唯一 `Add inside` 提供；required Parallel Output 保留自己的 Add before 例外。裸 reorder/remove 使用共享 icon，具体 Add/Remove object 与业务命令保留文字，不按动词机械替换。

正文空间优化优先压缩固定 chrome，而不是牺牲用户输入正文：idle runner 的 status、Start/Pause/Stop 和 Debug 改为同一行，Debug 展开按钮用浮层避免撑高 dock；waiting input 仍独占完整下一行。最终不是一个全局 compact scale：Macro view tabs 与 runner controls 都为 28px，正文 node actions 为 24px；workspace topbar 回调为 36px，Macro/Prompt/New/Settings 统一为 28px/12px；Macro template header 实测为 39px，Prompt/Trace header 为 38px。terminal tab 仍为 34px，terminal meta 仍为 36px。Macro、Prompt、Trace 的核心 title/label/body/action 收敛到 14/12/13/12px，JSON preview/editor 为 14px；terminal/Text 正文字号不变。

Flow body 的结构入口按容器是否为空决定，而不按 node type 增加第二套按钮。每个空 `NodeListEditor` 只渲染一个通用 `Add inside`；插入第一个 child 后，占位消失，继续插入使用 child 的 Add before/after。control action body 仍传入 action-only palette，普通 action 自己的 before/after 不变。Parallel lane 是受限 action list，保留 Add before/after 触发器，但弹窗完整复用主 `macro-insertion-mode` 和 `floating-insertion-palette`，并继承 near/center 设置。

Text 行号采用逻辑行、1-based、独立 gutter。为避免 textarea soft wrap 后后续行号与正文垂直错位，Text tab 使用 code-editor 式 `wrap=off`，长行水平滚动；这不改变保存内容。

rename 不增加 document 级 click-away listener。现有 blur commit 已经正确，根因只是动态 input 未 focus；因此在 DOM 更新后 focus，并把 selection 折叠到 alias 末尾即可。

JSON 不直接把每次键入写入 `MacroTemplate` draft。最终使用隔离 buffer：Edit 时拍摄当前 JSON，Save 成功后才替换 draft，Cancel 直接丢弃 buffer。编辑期间锁住所有会替换 draft 或使用旧 draft 启动运行的入口，从状态所有权上消除静默丢失和运行错版本。锁的边界从 callback 起点扩展到整个异步提交窗口：MacroPanel 为 lock-sensitive operation 维护 pending counter 与单调 generation，捕获 config id、selected template id、draft id 和 draft revision；pending 时 JSON Edit 与整个 visual editor 分别 disabled/inert，child 不再通过 `bind:draft` 写入，所有 mutation 统一调用父层 `updateDraft()`。任何绕过 DOM lock 的 mutation attempt 都由该入口拒绝并推进 revision，使正在等待的旧 callback 失效。每个 await 后只允许当前 generation、identity/revision 未变且 `jsonEditing === false` 的 callback 继续提交。Runner Start 必须在 save 与 list 两次复核之后才发送 start request；JSON Save 自身也使用独立 edit-session generation，config 切换后旧 response 不得回写。

collapse 不进入 template JSON，也不跨 template 保存。`MacroStepList` 以 `draft.id` keyed mount，因此 template replacement 会获得全新的 editor-local state；同一 template 内删除普通 node、ELIF/ELSE subtree 或 Parallel lane 时，先收集被删除结构的全部 node/action ids，再清理 node、branch 和 lane-action collapse keys。id rename 迁移当前 key，真正删除则回收 key，从而让删除后自然复用的同名节点默认展开。
