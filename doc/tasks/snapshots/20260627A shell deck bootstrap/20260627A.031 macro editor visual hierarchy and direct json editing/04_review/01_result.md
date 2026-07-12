# Review Result

## 总体判断

本轮同时审阅代码和文档。连续复测后的全部场景都已落地：Macro 每个 body depth 使用稳定、清晰且相邻不同的 IDE accent guide 配色；竖向 guide、node 左边框和下边 branch 全部为同色、同粗的 2px 连续实线，guide 与 node 左边框精确重合，因此两个缩进只有两条竖线；node 不绘制上边线，bottom branch 在 18% 后开始淡出并于 52% 透明，sibling 只用留白而没有独立 divider。if/elif/else 是无边框、无额外横向缩进的 flat branch section，内部 action body 是唯一正式缩进，并与同层 for body guide 对齐。所有递归 body 都是不可点击的 layout div，可见 UI 只保留静态 `Flow V2 Body`，不再显示 Root/for/if/elif/else/control body summary。普通 Flow node 与 Parallel lane action 复用标题行右侧的六图标 action component，顺序固定为 Collapse、Move up、Move down、Add before、Add after、Remove；六项均使用与其他 Macro action 一致的独立标准 button shell。message part、text-list item、extract filter 和 ELIF/ELSE 的裸 Up/Down/Remove 也已统一为共享 icon-only controls；Remove 使用 Lucide Trash2，Add Text/Add inside/Add elif/Add else 等具体语义动作保留文字。每个 IF/ELIF/ELSE 的折叠按钮位于右侧 contextual action group 最左端、紧邻 Add/Remove，只隐藏自己的 condition/body，不影响 label、actions 或 sibling branches；折叠后与 node/Parallel action 统一显示 `Collapsed` badge 和 blue-tint active toggle。branch 标题也使用固定两列，badge 不会推动 actions。IF/ELIF/ELSE 的 contextual actions 已全部归位 label row，支持就地增加 ELIF、唯一 ELSE 的动态 Add hide/restore，以及 ELIF/ELSE 删除；required Output 保持专用例外。workspace topbar 是统一的 36px 单行，Macro/Prompt/New/Settings 全部为 28px/12px；Macro/Prompt/Trace header 为 39/38/38px，并共享 12–14px 内容尺度；Macro JSON code 为 14px；Text tab 有滚动同步的逻辑行号；rename input 双击后立即 focus 且 caret 在尾部；Macro JSON 具备默认只读、隔离 Edit buffer、Save/Cancel 和跨组件 lock。

JSON Save 复用唯一 current-schema validator，并额外冻结所选 template id 与 config id；parse/schema/identity/server 任一失败都保留 buffer 且不替换 draft。Close Gate 复审随后发现：已经发出的异步 Select/Start 等操作可在 response 返回时绕过 JSON edit lock，collapse id 会跨 template 或删除重建错绑，并且首轮 pending lock 没有覆盖仍可通过 `bind:draft` 写入的 visual editor。最终 MacroPanel 使用 pending counter、operation generation 与 config/selection/draft/revision identity 保护整个异步提交窗口；MacroEditorShell 不再拥有 draft 写权限，pending 时完整 editor disabled/inert，唯一 mutation guard 会拒绝绕过并使旧 operation revision 失效。Runner Start 在 save/list 复核前不发请求，revision 改变时也不发请求；Macro editor 按 template id remount，并在 node/branch/lane 删除时递归回收 collapse keys。连续复测修正了粗高饱和层级线、sibling separator、三层 runner dock、控件统一缩放过头、topbar 同栏两套尺度、Macro/JSON 字号过小、Prompt/Trace 视觉尺度漂移、flow inside 重复入口、Parallel inline popup，以及每层 guide/node border 分离造成的双线和低对比 palette。最终 focused browser regressions、两组受影响旧 task recipe、全量 unit/integration 和静态 Gate 均通过。post-review 未发现剩余 P1/P2，当前 change 可以通过 Close Gate。

## Gate 结论

通过。

* `just check`：通过，Svelte/TypeScript 0 errors / 0 warnings。
* `just build`：通过，198 modules；JS 600.81 kB（gzip 167.73 kB），CSS 49.18 kB（gzip 9.75 kB）。父 change 已存在的 Vite `>500 kB` single-bundle warning 仍在，按冻结停止线记录。
* `LD_LIBRARY_PATH=<existing-steam-run-fhs-lib64> just test-031`：4 个 JSON helper unit tests、8 assertions，以及 14 个 Chromium E2E 全部通过；新增 delayed Select/Start、delayed visual Save/Start revision、跨 template collapse、node/lane action id 复用回归，并覆盖原有 `.031` 与 terminal/Macro 场景。
* `LD_LIBRARY_PATH=<existing-steam-run-fhs-lib64> just test-021`：6 个 capability unit tests、17 assertions 和 1 个 Chromium E2E 全部通过；覆盖 Parallel popup 在 shell/text lane capability 过滤后的行为。
* `LD_LIBRARY_PATH=<existing-steam-run-fhs-lib64> just test-026`：136 个 scoped-template unit/integration tests、668 assertions 和 2 个 Chromium E2E 全部通过；覆盖非空 for body 从 child Add before 移回 template consumer。
* `just test-unit`：300 tests、1793 assertions 全部通过。
* `git diff --check`：通过。
* 旧路径、current-schema 与视觉参数 scan：MacroJsonView 不再持有旧 `ValidationResult/onSaveTemplate` 只读 Save 路径；JSON helper 无 migration/legacy/alias/normalize/convert 分支；五个递归 `NodeListEditor` 调用全部显式传递 depth；旧 muted palette、top/bottom dash/gap branch、分离 guide/accent、if branch shadow rail、body details/summary、字符版 `▸/▾/↑/↓` structural controls、文字版 Collapse/Move up/Move down 和 sibling-only divider 未残留；`node-add-inside-if/elif/else/for/control` 与 Parallel 专用 palette CSS 未残留。

## Findings and Solutions

### P1/L1，已修复：JSON 输入若直接污染 draft 会产生静默丢失或运行错版本

* 位置：`src/lib/components/MacroPanel.svelte`、`MacroJsonView.svelte`、`src/lib/macro/macroJsonDraft.ts`。
* 问题：直接把 textarea 每次输入写入 visual draft，会让未完成 JSON、视图切换、模板选择和 Runner Start 共享一个半合法对象。
* 为什么重要：parse/schema 错误可能污染 visual editor；切换模板可能静默丢 buffer；Runner 可能保存并运行用户没有成功确认的版本。
* 证据：最终 Edit 只写独立 string buffer；invalid JSON E2E 证明 server template 不变，Cancel 恢复原 preview，valid Save 才更新 server/draft。unit tests独立覆盖 malformed JSON、extra field、id/configId mismatch。
* 推荐处理：由 MacroPanel 统一拥有 edit session 与 lock；Save 使用 parse → current schema → identity → server 的单向提交链。
* 修改归属：代码与文档一起改，已完成。
* 是否阻断 Gate：是，已解除。

### P2/L1，已修复：已发出的异步操作可以绕过 JSON edit lock

* 位置：`src/lib/components/MacroPanel.svelte`、`MacroWorkbenchChrome.svelte`、`MacroJsonView.svelte` 与 `tests/e2e/macroEditingUx.spec.ts`。
* 问题：原 lock 只在 callback 起点调用 `blockForJsonEdit()`；Select/New/Save/Duplicate/Delete/Import/Runner Start 若先进入 await，随后用户开始 JSON Edit，旧 response 仍可替换 draft/selection/list，Runner Start 还会在 save 返回后继续发出 start request。
* 为什么重要：JSON buffer 可能来自 template A，但当前 draft 已被旧 Select response 换成 template B；Save 后又可能回写错误 identity。Runner 也可能运行 JSON Edit 尚未提交的旧 visual draft。
* 证据：MacroPanel 现在为 config reload、template operations、Export 与 Runner Start 维护 pending counter 和单调 generation，operation token 冻结 config/selected/draft/revision identity；每个 file/HTTP await 后都复核 generation、identity 与 `jsonEditing`。pending 同时禁用 template controls、Runner Start、JSON Edit/Export，`startJsonEdit()` 仍有 defensive guard。Runner Start 在 save 与 list response 都通过复核后才调用 `/runner/start`；JSON Save 另有 edit-session generation。delayed-response Chromium E2E 将真实 Select/PUT response 扣住，证明 Edit disabled、强制绕过 DOM disabled 仍不能创建 buffer，且 Start save response 未释放前 runner start request 为零；释放后只提交目标 template 并正常进入 waiting run。
* 推荐处理：用单一 operation lifecycle 管理“请求已发出但尚未提交”，而不是给 Select 或 Start 增加特判；旧 generation/config/edit session response 必须静默丢弃 UI 提交。
* 修改归属：代码、测试与 `.031` 文档一起改，已完成；active spec 的公开 JSON contract 不变。
* 是否阻断 Gate：是，已解除。

### P2/L1，已修复：pending operation 期间仍可修改 visual draft

* 位置：`src/lib/components/MacroPanel.svelte`、`src/lib/components/macro/MacroEditorShell.svelte`、`src/styles/macro-workbench-cleanup.css` 与 `tests/e2e/macroEditingUx.spec.ts`。
* 问题：首轮 `operationPending` 只到 template chrome 和 JSON view；MacroEditorShell 仍通过 `$bindable`/`bind:draft` 与自己的 `updateDraft()` 改写同 id draft。operation token 只看 draft id，因此 delayed Save/Start response 会把 pending 期间的新节点编辑覆盖，Start 还会执行请求开始时的旧 clone。
* 为什么重要：同一个 template id 内发生静默数据丢失，且 UI 可见草稿与实际运行版本分叉；仅锁 JSON Edit 并不能保护 visual draft ownership。
* 证据：MacroEditorShell 已删除 `$bindable` 和组件内 clone/write，recursive editor 与 metadata 全部调用 MacroPanel 唯一 `updateDraft()`。每次 draft mutation/replacement 都推进 revision，operation token 同时冻结并复核 revision。pending editor 使用 reset 后的 fieldset 整体 `disabled + inert`；若脚本移除 DOM lock 后强制 dispatch field mutation，父层 guard 拒绝修改并推进 revision，使 delayed Save response 不得替换 draft，使 delayed Start 在 PUT response 返回后、发出 `/runner/start` 前终止。Chromium E2E 同时断言 node field disabled/inert、JSON preview 保持原 id、server template 保持原 id、Start request 数量为零且 runner 仍 idle。
* 推荐处理：draft mutation 只有一个父层入口；UI lock 负责正常交互，revision identity 与 defensive guard 负责 stale/programmatic path，二者不能互相替代。
* 修改归属：代码、测试及 `.031/02_spec`、`.031/04_review` 一起改，已完成；active spec 无需改变。
* 是否阻断 Gate：是，已解除。

### P3/L1，已修复：collapse 状态会错绑到另一个 template 或重建节点

* 位置：`MacroEditorShell.svelte`、`MacroStepList.svelte`、`ParallelLaneTabs.svelte` 与 `tests/e2e/macroEditingUx.spec.ts`。
* 问题：collapse arrays 只按 node/action id 存活；template replacement 不 remount editor，普通 node/branch/lane 删除也没有完整回收所属 keys。默认 `send`、`lane_2` 等 id 自然复用时，新结构会直接显示 collapsed。
* 为什么重要：不损坏 Macro JSON，但会隐藏用户未主动折叠的新内容，且 UI 状态跨越了其 ownership 生命周期。
* 证据：MacroStepList 现在位于 `{#key draft.id}` 内；删除普通 node 时通过 body path 收集完整 subtree ids，删除 ELIF/ELSE 同样清理其 body，node id rename 迁移当前 key。Parallel lane 删除先收集全部非 Output action ids并清理 lane-action collapse state，单 action 删除与 id rename 保持同一规则。Chromium E2E 证明两个 template 复用 `send` 时不继承 collapse；删除 collapsed `send` 后新建同 id node、删除含 collapsed `send` 的 `lane_2` 后重建 lane/action，都默认展开。
* 推荐处理：template switch 用 keyed remount 确定 editor-local state 边界；同 template 内的结构删除递归回收，rename 才迁移，避免保留 orphan key。
* 修改归属：代码、测试与 `.031` 文档一起改，已完成。
* 是否阻断 Gate：否，已随 F1 一并收口。

### P2/L1，已修复：rename blur contract 因 input 未 focus 而无法第一次 click-away

* 位置：`src/lib/components/workspace/TerminalTabBar.svelte`。
* 问题：input 动态挂载后焦点仍在原 tab；第一次点击外部不是从 input blur，因此不会提交。
* 为什么重要：UI 看似支持 blur save，真实行为却要求额外点击输入框，且 caret 行为不确定。
* 证据：Chromium 回归在不点击 input 的前提下断言 input focused、selectionStart/End 等于 alias 长度，键入后点击 Text editor 即完成 rename。
* 推荐处理：挂载后的 Svelte tick focus input，并把 selection 折叠到末尾；继续复用唯一 `commitRename`。
* 修改归属：只改代码，已完成。
* 是否阻断 Gate：是，已解除。

### P2/L1，已修复：Macro 层级和 Text 行定位缺少足够视觉锚点

* 位置：`MacroStepList.svelte`、`macro-workbench-base.css`、`TextBoxSlot.svelte`、`terminal.css`。
* 问题：嵌套 guide 近似同色、sibling 只有普通 gap；Text document 无行号。
* 为什么重要：长宏难以判断 block ownership，多行 Text capture 输入难以定位和核对。
* 证据：最终 E2E 断言 depth 0/1 computed guide 是冻结的 cyan-blue/teal，均为 2px、`0.92` opacity；各 depth 的 node 左边框与 guide 同色同粗且横坐标误差小于 0.5px，四个 guide/border 测点只有两个唯一位置。每个 node 的 bottom branch 为连续 2px 实线、覆盖超过 80%、`background-image: none`，mask 使用 18%/28%/52% 快速 fade stops；`::after` content 为 none、card top border 透明，sibling 保留 14px whitespace。Text 空内容显示 1，120 行显示连续到 120，scroll transform 同步且 server 正文逐字符不含行号。
* if branch evidence：IF/ELIF/ELSE section 的 left border/padding/margin 均为 0、背景透明，label 使用 uppercase neutral badge；同层 if body 与 for body 的全局 guide x 误差小于 0.5px，证明 branch wrapper 不再创造伪 depth。
* 推荐处理：使用不含紫色、且末层不与首层近似的四色清晰 IDE accent depth palette；把 node left border 叠到 vertical guide，底部使用同粗的 solid/masked branch 与 whitespace；Text gutter 只渲染 UI 行号且采用 no-wrap 对齐。
* 修改归属：代码与文档一起改，已完成。
* 是否阻断 Gate：是，已解除。

### P2/L1，已修复：每层 guide 与 node 左边框分离导致缩进线数量翻倍

* 位置：`MacroStepList.svelte`、`macro-workbench-base.css`、`macro-workbench-cleanup.css`、`macroEditingUx.spec.ts`。
* 问题：body guide 位于 parent 左边，node 左边框又位于 14px padding 之后；两个 depth 会显示四条竖线。guide 只有 1px/0.78 opacity，底边只是 1px continuous gradient，结构对比和虚线语义都不足。
* 为什么重要：card 竖边框会被误认为额外 indent guide，用户无法从线条数量直接判断真实 depth；过淡 guide 和过细 branch 又降低了快速扫描能力。
* 证据：最终 node 使用 `-14px` margin 把 2px 左边框移到 body guide，并用 `21px` left padding 保持正文横坐标；Chromium E2E 证明 root/nested 各自 guide/border 重合，四个测点只有两个唯一位置。branch 使用连续 depth color 底色与独立 `mask-image` fade，实测高度同为 2px，并断言 `background-image: none` 防止 dash pattern 回归。
* 推荐处理：共享 `--flow-guide-width` / `--flow-indent-offset`，让 guide、border、branch 的几何关系由一套变量驱动；颜色使用固定清晰 IDE accent palette。
* 修改归属：代码、测试与文档一起改，已完成。
* 是否阻断 Gate：是，已解除。

### P2/L1，已修复：多轮层级强调、topbar 与 panel scale 不平衡

* 位置：`MacroStepList.svelte`、`macro-workbench-base.css`、`macro-workbench-cleanup.css`、`macroEditingUx.spec.ts`。
* 问题：第一轮采用高饱和粗 guide/accent 和粗 gradient divider；第二轮把 view tabs、runner controls 和 node actions 收得过小；第三轮又只缩 New terminal；第四轮发现 34/26px topbar 与过薄 Macro header 略压过头，同时 Prompt/Trace 还保留 18px title、12px section padding 的旧尺度。
* 为什么重要：颜色条会抢过字段正文，重复横栏会让长 Macro 需要更多无意义滚动；同栏或同 workbench 多套尺度破坏视觉层级；核心文字过小直接影响长 Macro/JSON 的可读性。
* 证据：最终 E2E 锁定 topbar 为 36px，Macro/Prompt/New/Settings 全部为 28px/12px；Macro/Prompt/Trace header 为 39/38/38px，Prompt/Trace title/body/action 为 14/13/12px，Trace tabs 为 28px；Macro section/label/node/textarea/gutter 为 14/12/13/13/13px，JSON preview/editor 为 14px；view tabs/runner/node actions 仍为 28/28/至少 24px，waiting-input 仍跨满第二行。
* 推荐处理：采用四色 IDE-like guide 与 bottom branch；把 idle runner 合并为单行；topbar 作为一个整体统一高度/字号；Macro、Prompt、Trace 用同一内容尺度，JSON code 独立放大，不影响 terminal/Text 正文。
* 修改归属：代码、测试与文档一起改，已完成。
* 是否阻断 Gate：是，已解除。

### P2/L1，已修复：flow body 重复 inside 入口与 Parallel popup 行为分叉

* 位置：`MacroStepList.svelte`、`ParallelLaneTabs.svelte`、`macro-step-editor.css`、Macro insertion E2E。
* 问题：空 if/elif/else/for/control body 同时出现专用 inside/action 按钮和通用 `Add inside`；Parallel popup 使用 inline section、420px width 和四列 grid，打开后撑开 lane 且不复用主 overlay/placement/focus contract。
* 为什么重要：同一插入动作出现两个入口会让用户误以为语义不同；Parallel 的视觉和键盘行为分叉会让 Add before 在不同 node 下表现不一致。
* 证据：最终源码只有 `NodeListEditor` 在空 body 渲染 `empty-body-add`；旧五组 named test id scan 为零。E2E 分别覆盖空 if/elif/else/for/control 的唯一 placeholder、非空 for 从 child Add after 增加第二个节点、control action-only palette；Parallel 与主 palette 的 computed position/width/padding/radius/shadow/grid 完全相等，并验证 placement mode 和首 action focus。`.021` capability E2E 与 `.026` scoped move-back E2E 也全部通过。
* 推荐处理：container-level 插入入口由通用 empty-body placeholder 唯一拥有；非空 body 复用 child before/after。Parallel 保留其受限 action trigger，但复用完整主 overlay/palette 基础设施。
* 修改归属：代码、测试与文档一起改，已完成。
* 是否阻断 Gate：是，已解除。

### P2/L1，已修复：body summary 与 node controls 重复且跨容器不一致

* 位置：`MacroStepList.svelte`、`ParallelLaneTabs.svelte`、`macro-workbench-base.css`、`macro-step-editor.css`、`.031/.021/.026` E2E。
* 问题：静态 `Flow V2 Body` 下仍有可折叠 Root body，各 for/if/elif/else/control body 又各自渲染 summary；node title 同行还放置文字版 Collapse/Move up/Move down，Parallel lane action 则没有 collapse，形成三套层级和控制语法。
* 为什么重要：body slot 与 action node 都可折叠会让用户无法判断折叠对象；重复 `xx body` 占据正文空间，文字结构按钮又挤压 Add/Remove，长标题和窄侧栏下尤其混乱。
* 证据：源码 `NodeListEditor` 只渲染 `div.flow-block`，`flow-block-summary`、`.flow-block-title`、字符 glyph 和文字版 node action scan 为零。Chromium E2E 证明可见编辑器只保留 `Flow V2 Body`，普通 node 与 Parallel action 复用的 action bar 各有六个独立标准 button shell 的 SVG controls，顺序、title/aria、disabled 边界、collapsed badge/blue-tint active/depth-color tint card 可观测。`.031` 14/14、`.026` 2/2 与 `.021` 1/1 browser regressions 已在本轮全部通过。
* 推荐处理：body 只管理递归布局；collapse、move、insert、remove 都属于 numbered node title 的唯一右侧 action bar。全部 controls icon-only 并提供 tooltip/accessibility name；required Parallel Output 保留不可移动的专用例外。
* 修改归属：代码、测试与文档一起改，已完成。
* 是否阻断 Gate：是，已解除。

### P2/L1，已修复：structural icon 画风分叉且 IF branch 操作脱离 ownership

* 位置：`NodeActionControls.svelte`、`MacroStepList.svelte`、`flowV2EditorCommands.ts`、`macro-workbench-base.css`、command unit 与 `.031` E2E。
* 问题：三个 structural icons 被包在 Macro 独有的 segmented shell 中，与相邻标准按钮不协调；Add elif/Add else 又悬在所有 branch 之后，无法表达具体 insertion anchor，ELIF/ELSE 也没有删除自身的入口。
* 为什么重要：视觉语言分叉会让 structural controls 看起来像另一套控件；global append 语义与按钮放到每个 ELIF 行后的空间语义冲突，且不可删除 branch 会迫使用户改 JSON。
* 证据：shared component 最终恰好输出六个 SVG，computed style 证明 container 为透明/零边框，button 使用标准白底/neutral border/4px radius，collapsed active 使用项目既有 blue tint。E2E 证明 IF、ELIF、ELSE 的按钮矩阵分别为 2/3/1，label/action 垂直中心误差小于 2px；从 ELIF 新增会紧跟该 ELIF，ELIF/ELSE 删除均确认；ELSE 存在时所有 Add else 为零，删除后 IF 与 ELIF 同时恢复。command unit 覆盖首个 IF 不可删、越界失败、contextual splice 和 ELSE remove。
* 推荐处理：结构操作永远贴着其 ownership surface；node、branch、collection、item 与 empty body 分别使用自己的 title/header/placeholder，禁止新增 detached global action row。
* 修改归属：代码、测试与文档一起改，已完成。
* 是否阻断 Gate：是，已解除。

### P2/L1，已修复：node controls 分组、文字按钮和继承 padding 破坏紧凑对齐

* 位置：`NodeActionControls.svelte`、`MacroStepList.svelte`、`ParallelLaneTabs.svelte`、`macro-workbench-base.css`、`macro-workbench-cleanup.css` 与 `.031` E2E。
* 问题：Collapse/Move 位于左侧三按钮组，Add before/Add after/Remove 位于右侧文字组，阅读顺序被拆开；折叠 badge 可能挤压 controls。通用 `.step-title button` padding 还会以更高 specificity 覆盖 icon 的零 padding，使 SVG 视觉偏右。
* 为什么重要：同一 node 的结构操作不应分裂成两套视觉语法；折叠状态变化不能使操作目标跳动，图标偏心会在连续六按钮中被明显放大。
* 证据：Flow 与 Parallel E2E 均断言唯一 action bar 恰有六个 icon-only buttons，固定顺序为 Collapse/Move up/Move down/Add before/Add after/Remove，旧 structural/edit group 为零。普通 node 进一步实测全部 button 为 24×24、SVG 为 15×15、四边 padding 为 0，水平/垂直中心偏差小于 0.6px；折叠前后 action bar 的 x/y 偏差也小于 0.6px。
* 推荐处理：使用标题行两列 grid 隔离左侧 title/badge 与右侧 action bar；用单一 shared component 输出全部六项，并以足够 specificity 固定 icon geometry。
* 修改归属：代码、测试与文档一起改，已完成。
* 是否阻断 Gate：是，已解除。

### P2/L1，已修复：collection 与 branch 残留裸文字结构按钮

* 位置：`MacroIconButton.svelte`、`MessagePartsEditor.svelte`、`MacroStepList.svelte`、`NodeActionControls.svelte`、Macro styles 与 `.031/.026` E2E。
* 问题：node action 已图标化，但 Send message part、text-list item 仍显示 Up/Down/Remove，extract filter 和 ELIF/ELSE 仍显示裸 Remove，形成同一 Macro editor 内两套结构操作语法。
* 为什么重要：高频排序/删除按钮占用标题空间且与 node controls 不一致；但把所有 Add/Delete 类动作一律图标化又会丢失具体对象和业务结果。
* 证据：源码 scan 中裸 Up/Down/Remove button 为零。`.031` E2E 断言 message part 的三个 controls、filter Remove、ELIF/ELSE Remove 均无可见文字且具有 SVG/title；Add elif/Add else 继续显示文字。`.026` E2E 断言 text-list item 的 Up/Down/Remove 为三个 SVG，并实际完成排序和删除。两组 browser recipe 分别 14/14、2/2 通过。
* 推荐处理：共享 `MacroIconButton` 只承载通用 Up/Down/Remove；Add Text/Add inside/Add elif/Add item/Remove lane 等具体语义动作保持文字，禁止按动词机械替换。
* 修改归属：代码、测试与文档一起改，已完成。
* 是否阻断 Gate：是，已解除。

### P2/L1，已修复：自绘垃圾桶拥挤且 IF branches 无法独立折叠

* 位置：`MacroIconButton.svelte`、`NodeActionControls.svelte`、`MacroStepList.svelte`、`macro-workbench-base.css` 与 `.031` E2E。
* 问题：原 16 viewBox 自绘垃圾桶在 15px 下桶盖、桶身和内部线条拥挤；整个 IF node 可折叠，但用户无法只收起某个 IF/ELIF/ELSE branch 的 condition/body。
* 为什么重要：Remove 是高频控件，粗糙图形会破坏整组 icon 观感；长分支无法独立收起会继续占据大量正文空间。
* 证据：Remove E2E 锁定 24 viewBox、五条 round-stroke path 的 Lucide Trash2。IF、ELIF、ELSE 分别实测 Collapse/Expand title 与 aria-expanded；折叠后自己的 body hidden、label actions visible，另外两个 branch body 仍 visible。branch 与 node/Parallel action 共享 `Collapsed` badge 和 blue-tint active computed colors，折叠前后 action group 坐标误差小于 0.6px；`.031` 14/14 通过。
* 推荐处理：由共享 primitive 唯一拥有 Trash2 和 collapse SVG；branch collapse 使用 editor-local key，并在 ELIF splice 与 IF node id 修改时迁移，不进入 template schema。
* 修改归属：代码、测试与文档一起改，已完成。
* 是否阻断 Gate：是，已解除。

## 需要人工拍板

无。

## AI 可直接修

全部范围内 P1/P2 已在当前 change 修复并补回归。未发现还需继续修改的明确项。

## 未覆盖与残余风险

* Text gutter 当前为每个逻辑行渲染一个轻量数字节点。常规文档与 120 行回归已覆盖；极端超大 Text document 的 gutter virtualization 不在本任务停止线内，保留为 P3 性能风险。Text 内容本身仍是完整同步正文，行号不会改变数据。
* 本机 Playwright 首次无显式 runtime 启动时，10 个用例都在约 3ms 的 browser launch 阶段因缺少 `libatk-1.0.so.0` 失败，没有进入任何产品断言。把已有 steam-run FHS `lib64` 加入 `LD_LIBRARY_PATH` 后，`.031`、`.021`、`.026` 的所有 Chromium E2E 均通过；这是父 change 已记录的验证环境约束，不是产品失败。
* `just test-unit` 首次在受限 sandbox 内运行时，13 个需要 `Bun.serve(port: 0)` 或 real PTY 的 integration tests 分别报 `EADDRINUSE`/timeout，其余 287 个通过；允许本地端口与 PTY 后，同一 recipe 为 300/300、1793 assertions 全部通过，没有产品断言失败。
* Vite inherited single-bundle size warning 仍存在；本任务没有引入 code splitting。
* 未引入 Monaco/CodeMirror、JSON syntax highlight/format/undo、beforeunload 或跨路由 dirty confirmation，均按 spec 排除。

## 审阅范围

* Macro visual：递归 body depth 传播、中等对比 palette、2px guide/node border 重合、2px solid/masked bottom fading branch、sibling whitespace、Macro/Prompt/Trace header/section/action density、waiting-input 第二行，以及 if/elif/else/for/control 的唯一 empty-body insertion 入口。
* Insertion：空/非空 flow body 分工、action-only control palette、普通 action before/after 保持，以及 Parallel overlay/scrim/near-center placement/viewport clamp/focus/Escape/focus restore。
* Workspace/terminal chrome：单行 brand/status、Macro/Prompt/New/Settings 36/28/12px 统一尺寸与 compact switch、tab strip/tab/index/alias/kind/close、terminal alias/id/status meta，以及 xterm/Text 正文字号不变边界。
* Typography：Macro section/field/node/action/textarea/gutter、template/delivery 提示，以及 JSON preview/editor/error/lock。
* Text/rename：TextBox local/server content ownership、gutter scroll/no-wrap、copy/capture 数据隔离、动态 rename input focus/caret、blur/Enter/Escape 复用。
* JSON/editor state：read-only/Edit/Save/Cancel/Copy，parse/schema/identity/server 失败语义，视图、模板 mutation/export 与 Runner Start lock，pending operation generation/config/template/draft-revision 复核、visual editor disabled/inert、统一 mutation guard、delayed response 顺序，以及 live-run 控制保留。
* collapse lifecycle：template keyed remount、普通/branch subtree 递归清理、lane/action 清理、rename key 迁移与删除后同 id 复用。
* regressions：新 unit/E2E、delayed Select/Start 与 collapse ownership、既有 Macro node insertion/workbench、tab capability、scoped template move-back 与 terminal deck E2E、全量 unit/integration。
* 文档：task meta/context/spec/plan、active Macro/terminal contracts、Quickstart、index 与最终 Gate evidence。
