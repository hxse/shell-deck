# Execution Plan

## 阶段 1：文档 Gate 与源码基线

* 冻结四组 UI contract、JSON dirty-state ownership、identity 失败语义和停止线。
* 核对 Macro recursive body、TextBoxSlot、TerminalTabBar、MacroPanel/MacroJsonView 与现有 E2E。
* 完成 AI 文档 pre-review；P1/P2 清零后进入实现。

## 阶段 2：视觉层级、Text 行号与 rename

* 给 `NodeListEditor` 显式传递 depth，并用 CSS custom property 驱动 guide/connector/accent。
* 增加 body 内 sibling divider，不修改 node insertion/move command。
* 给 TextBoxSlot 增加独立 gutter、scroll sync 与 no-wrap textarea。
* TerminalTabBar 在 rename input mount 后 focus 并折叠 caret 到尾部。
* 在 terminal/macro E2E 中补 computed style、line number 和 focus/blur 回归。

## 阶段 3：JSON direct edit

* 提取可单测的 JSON parse/current-schema/identity helper。
* MacroPanel 持有 edit buffer、baseline identity、error 和 lock 状态。
* MacroJsonView 实现 read-only/Edit/Save/Cancel/Copy。
* MacroWorkbenchChrome、MacroTemplateSelector 和 MacroRunDock 接入 lock，父层 callback 保留防御性 guard。
* 补 helper unit tests 和 visual editor/JSON 切换 E2E。

## 阶段 4：复测后的视觉密度收口

* 用 Chromium trace 核对第一轮 depth palette、guide/accent/divider 与固定 chrome 的实际视觉重量。
* 把高饱和粗 guide 收敛为 IDE-like muted palette、1px guide/connector、2px accent 和 1px sibling divider。
* 把 idle runner dock 收为单行，压缩 header/view tabs，并小幅收紧 section、card、field 与次要 action；waiting input 保留完整第二行。
* 增加 chrome height、guide width、accent width 和 divider width 的 computed-style E2E 回归。

## 阶段 5：第二次复测后的树线与分组尺寸校准

* 把 node top connector 改成仅位于底边、向右渐隐的 branch，删除 sibling-only divider，保留 14px whitespace。
* 将 Macro view tabs、runner controls 和 node actions 回调到 28/28/24px，避免正文操作过小。
* 单独收紧三个 New terminal buttons、terminal tabs 和 terminal alias/id meta，不修改 Macro/Prompt toggles、Settings 或 terminal/Text 正文。
* 用 Chromium trace 做实际视觉复核，并用 Macro/terminal E2E 冻结每组 computed size。

## 阶段 6：第三次复测后的 topbar 与 typography 修正

* 把 workspace topbar 的 brand 收成单行并把整栏降到 34px，Macro/Prompt/New/Settings 统一为 26px/12px。
* 将 Macro section/label/node/textarea typography 提升到 14/12/13/13px，操作按钮统一为 12px。
* 将 JSON preview/editor 独立提升到 14px/1.55，并同步 textarea gutter 到 13px。
* 用 Chromium trace 核对真实画面，并增加 topbar、Macro typography、gutter 与 JSON computed-font E2E。

## 阶段 7：首轮 Close Gate

* 运行 focused 与全量 check/build/unit/E2E Gate。
* 审查当前 change 相对 `@-` 的代码和文档映射，扫描旧只读 JSON/无 focus 路径。
* 修复全部 P1/P2，回填 `04_review`，同步 active specs、quickstart 和 index 状态。

## 阶段 8：第四次复测后的面板协调与 insertion 收口

* workspace topbar 从 34/26px 回调为 36/28px；Macro template/Reset width header 回调到实测 39px。
* Prompt/Trace header、section、field、action 与 tabs 按 Macro 的 12–14px 层级重新校准，并保持 Prompt 默认宽度与正文 minimum 不变。
* 删除 if/elif/else/for/control 的专用 inside/action 按钮；空 body 只保留通用 `Add inside`，非空 body 使用 child Add before/after。
* Parallel lane insertion 改为与主 insertion 相同的 overlay/scrim/palette、near/center placement、viewport clamp、focus、Escape 和 focus restore。
* 更新旧 E2E locator，并增加 Prompt/Trace computed size、唯一占位和 palette computed-style 等价断言。

## 阶段 9：最终 Close Gate

* 运行 focused 与全量 check/build/unit/E2E Gate，并单独记录首次缺少 `libatk` 的 launch-only 环境失败与带既有 FHS runtime 的正式结果。
* 扫描旧命名 inside 入口、Parallel 专用 palette 样式、旧 34/26px 文档值和未同步 active spec。
* 回填最终 `04_review` 与 bundle size，确认当前 change 无剩余 P1/P2。

## 阶段 10：第五次复测后的 tree line 合并

* 把 depth palette 调整为清晰的 blue/teal/orange/rose，并把 guide opacity 提升到 `0.92`；第三层使用明亮 orange，避免呈棕色，删除与首层接近的末层 cyan。
* 统一 guide/node left border 为 2px；node 使用负 margin 与 padding compensation 把左边框叠到 guide 上，保持正文横坐标不变。
* bottom branch 提升到同为 2px，使用 6px/4px repeating dash 和独立 mask fade，保留 bottom-only/no-top contract。
* E2E 冻结颜色、宽度、opacity、dash/mask，以及“两层只有两个唯一线位”。

## 阶段 11：最终复核

* 运行 `.031` focused Chromium、静态 check、production build 和 patch scan。
* 同步 active Macro spec、Quickstart、task index 与 review evidence。

## 阶段 12：实线 branch 与 palette 复测收口

* 将 bottom branch 从 dash/gap repeating pattern 改为连续 2px 实线，保留独立 mask 向右渐隐。
* 将灰暗 muted depth palette 替换为不含紫色、且末层不与首层近似的清晰 IDE accent 四色，并同步 guide、node border 与 details marker。
* E2E 冻结新 root/nested 颜色并断言 branch 不再存在 background image/dash pattern。

## 阶段 13：顶部渐隐虚线

* 为每个 flow node 增加 2px top branch，最终使用视觉间隔明确的 8px/6px repeating dash 和独立横向 fade mask。
* 将 card 原 neutral top border 设为 transparent，确保 dash gap 真实透明；bottom branch 继续保持连续渐隐实线。
* E2E 分别冻结 top dashed/bottom solid、覆盖宽度、mask、厚度和 sibling whitespace。

## 阶段 14：上下与缩进线统一实线

* 按用户澄清移除 top repeating gradient；竖向 guide、node left border、top branch、bottom branch 全部统一为 2px continuous solid。
* top/bottom branch 共享同一套 background、mask、opacity 和厚度声明，只保留定位差异，避免样式再次漂移。
* E2E 同时断言 top/bottom 的 `background-image: none`、相同 depth color 和 2px thickness。

## 阶段 15：取消 node 上边线

* 删除 `.flow-node-editor::after` top branch，保留透明 card top border，确保 node 顶部不出现任何线。
* 竖向 guide、node left border 和 bottom branch 继续共享 2px continuous solid contract。
* E2E 断言 `::after` content 为 none、card top border 透明，同时保留 bottom branch 与两层两线几何回归。

## 阶段 16：移除 if branch 伪缩进

* 将 `flow-branch-card` 收为 flat section，移除 border、left padding、margin-left、背景 rail 和嵌套 card 外观。
* 使用紧凑 uppercase keyword badge 与 10px vertical whitespace 区分 IF/ELIF/ELSE；内部 action body guide 保持唯一正式缩进。
* E2E 冻结 branch section 零 border/padding/margin、透明背景和 badge，并比较同层 if body/for body guide 横坐标。

## 阶段 17：删除 body summary 并统一 node chrome

* 把所有递归 body 从 `details/summary` 改为 non-interactive `div`，删除 Root/for/if/elif/else/control action body 的可见标题和 node count，只保留静态 `Flow V2 Body`。
* 普通 Flow node 将 node-level controls 收到编号标题行；collapsed state 使用 chevron、active button 和 card 背景变化。
* Parallel lane action 接入相同编号、tooltip 和本地 collapse，required Output 维持专用例外；controls 的最终单组形态在阶段 20 收口。
* 将 bottom mask 改为 18%/28%/52% 快速 fade，并同步 focused `.031`、`.021`、`.026` E2E 与旧文案残留 scan。

## 阶段 18：structural icon 与 collapsed state 视觉收口

* 抽取 Flow node 与 Parallel lane action 共用的 node action visual primitives，把字符 chevron/arrow 替换为 15px round-stroke SVG；最终 component contract 在阶段 20 扩展到全部六项。
* 将三个独立方按钮收为单外框 segmented toolbar，统一 default/hover/active/disabled/focus-visible 状态。
* collapsed node 增加 `Collapsed` badge、depth-color 实心 toggle 和 depth-color tint card；E2E 冻结 SVG、badge、toolbar 与 active/tint computed style。

## 阶段 19：按钮画风与 IF branch ownership 收口

* 保留 shared SVG component，但移除 segmented container shell；三个 icon 恢复为与 Macro 普通 action 相同的独立白底、neutral border、4px radius button，active 改用既有 blue-tint 语言。
* 将 Add elif/Add else 移入 IF 与每个 ELIF 的 label row；Add elif 按 clicked branch 就地插入，ELSE 存在时全部 Add else 隐藏。
* 为 ELIF/ELSE label row 增加带确认的 Remove，首个 IF branch 不可删除；删除 ELSE 后恢复 IF/ELIF 的 Add else。
* 核对 Parallel lane、text-list、message part、filter、empty body 和 Output 的 action ownership；已正确归属的 surface 不改。补 command unit 与 Chromium DOM/geometry/dynamic-state 回归。

## 阶段 20：六图标 action bar 与几何对齐收口

* 用 `NodeActionControls` 取代只负责前三项的 shared component，把 Add before/Add after/Remove 同步改为 SVG icon-only button。
* 普通 Flow node 与 Parallel lane action 都只保留标题行右侧一个六按钮 action bar，固定 Collapse/Move up/Move down/Add before/Add after/Remove 顺序。
* 把 `Collapsed` badge 放入左 title cluster，标题行使用两列 grid，确保 badge 出现不推动右侧操作栏。
* 以高于通用 `.step-title button` 的 selector 明确覆盖 icon button 为 24px、零 padding、12px chrome font，并保持 15px SVG 居中。
* E2E 冻结六按钮数量、顺序、icon-only、旧分组消失、折叠前后 action bar 坐标，以及 button/SVG 中心点偏差。

## 阶段 21：collection/branch 通用 item actions 图标化

* 新增共享 `MacroIconButton`，提供 Up、Down、Remove 三种 15px SVG，并让 node action controls 复用同一 `macro-icon-button` 视觉 contract。
* 替换普通/Parallel message parts、text-list items、extract filters 与 ELIF/ELSE 的裸 Up/Down/Remove 文字按钮。
* 保留 Add Text/Add Source/Add inside/Add elif/Add else/Add item/Add filter/Add lane/Remove lane 等具体语义文字按钮；源码 scan 冻结裸 Up/Down/Remove 为零。
* `.031` E2E 覆盖 message/filter/branch，`.026` E2E 覆盖 text-list 排序删除，并断言 icon-only、title 和 SVG 数量。

## 阶段 22：Lucide Trash2 与 IF branch 独立折叠

* 扩展 `MacroIconButton` 的 Collapse/Expand/active/aria-expanded contract；Node controls 复用该 primitive。
* 将所有 Remove 统一为 24 viewBox Lucide Trash2，并保持 15px rendered geometry。
* 在 IF/ELIF/ELSE 右侧 contextual action group 的最左端增加折叠按钮，固定 collapse → Add/Remove 顺序；collapsed branch 仅隐藏自己的 condition/body，label 与右侧 contextual actions 保持可见。
* branch 与 node/Parallel action 统一使用 `Collapsed` badge + blue-tint active toggle；branch title 使用固定两列，E2E 冻结 action order、badge、computed colors 与折叠前后 action 坐标。
* branch collapse key 以 IF node id + branch slot 管理；插入/删除 ELIF 时迁移后续索引，重命名 IF node 时迁移 prefix，状态不持久化。
* `.031` E2E 分别覆盖 IF、ELIF、ELSE 的独立折叠、aria/title、其他 branch 可见性，以及 Trash2 viewBox/path contract。

## 阶段 23：Close Gate 复审的异步 lock 与 collapse lifecycle 收口

* MacroPanel 为 config reload、New/Select/Save/Duplicate/Delete/Import/Export 与 Runner Start 建立 pending counter、单调 generation 和 config/selection/draft identity token；每个 await 后复核，pending 时先禁用 JSON Edit、template chrome mutation 与 Runner Start；visual editor/revision 边界在阶段 24 补齐。
* Runner Start 在 template save 与 list response 均通过复核后才发出 start request；JSON Save 增加独立 edit-session generation，旧 config/edit response 不回写。
* `MacroEditorShell` 按 `draft.id` keyed remount；普通 node、ELIF/ELSE subtree、Parallel lane/action 删除时递归回收 collapse keys，id rename 只迁移现有 key。
* `.031` 增加 delayed Select、delayed Start、跨 template 同 node id、删除后 node id 复用及 lane action id 复用 E2E，随后重跑静态、build、focused browser 与全量 unit Gate。

## 阶段 24：pending visual draft revision 收口

* 删除 `MacroEditorShell` 的 `$bindable` draft 与组件内 clone/write，把 Macro metadata 和 recursive editor 的 mutation 统一交给 `MacroPanel.updateDraft()`。
* 为每次 normal mutation、draft replacement 与 pending mutation attempt 推进 draft revision，并将 revision 冻结进 lock-sensitive operation identity；每个 await 后连同 generation/config/template/JSON state 一起复核。
* pending 时用 reset 后无布局偏移的 fieldset 将完整 visual editor 同时设为 disabled/inert；父层 mutation guard 继续防御脚本或 stale callback 绕过 DOM lock。
* 增加 delayed visual Save/Start E2E：字段在 pending 时 disabled，强制 dispatch 的修改不进入 draft；Save response 不覆盖当前 state，revision 改变时 Runner Start request 保持为零。

## 预计文件影响

* `src/lib/components/macro/MacroStepList.svelte`
* `src/lib/components/macro/NodeActionControls.svelte`
* `src/lib/components/macro/MacroIconButton.svelte`
* `src/App.svelte`
* `src/styles/base.css`
* `src/styles/run-log.css`
* `src/styles/macro-workbench-base.css`
* `src/styles/macro-workbench-cleanup.css`
* `src/lib/components/TextBoxSlot.svelte`
* `src/styles/terminal.css`
* `src/lib/components/workspace/TerminalTabBar.svelte`
* `tests/e2e/terminalDeck.ui.spec.ts`
* `src/lib/components/MacroPanel.svelte`
* `src/lib/components/macro/MacroJsonView.svelte`
* `src/lib/components/macro/MacroWorkbenchChrome.svelte`
* `src/lib/components/macro/MacroTemplateSelector.svelte`
* `src/lib/components/macro/MacroRunDock.svelte`
* 新增 Macro JSON edit helper 与 tests
* `justfile`、`package.json`、相关 E2E
* 当前 task、active specs、quickstart 与 index

## 验证与停止线

P1/P2、JSON buffer 丢失、invalid JSON 污染 draft、rename 仍需第二次点击、行号与正文错位、相邻 depth 同色、idle chrome 回退为多层高栏、本任务新增 warning 或 Gate failure 阻断交付。

不实现 JSON IDE、全应用 dirty router、Text soft-wrap 行号算法、shell terminal 行号、全局 design system、通用 textarea 重构或 Macro schema 改造。父 change 已存在且本任务未放大的 Vite bundle-size warning 若仍存在，只在 review 中记录，不扩张为当前任务的 code splitting。
