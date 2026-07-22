# Review Result

## 结论

`20260722B.002` implementation、Code/Test Gate与自审完成。App、Home、Room/workspace outer shell、terminal tabs/slots、Text slot、Settings和notice已迁移到daisyUI semantic class与Tailwind static utility；DOM结构、product handler和Room/terminal protocol未改。xterm由canonical effective light/dark metadata驱动两份完整palette，运行中只更新existing instance的`options.theme`。

## 实现映射

* App/Room chrome：topbar、controller/observer state、panel toggle、create button、Settings、notice、Home list/empty state全部消费`base-*`及semantic state token；保留原tag、nesting、order、aria、test id与event handler。
* Workspace：desktop side-panel width/resizer、981–1100收缩、<=980纵向排列、<=640 topbar wrap/tab 122px、<=680 Home stack、<=1260 panel minimum、stage padding与30px terminal metadata均在原markup上表达；全部`max-width`使用显式inclusive media variant，640/680/980/1100/1260精确值属于窄侧。inline panel width和Text line-number transform继续由existing runtime style拥有。
* Terminal：`src/lib/terminal/xtermTheme.ts`唯一拥有light/dark完整`ITheme`；`src/lib/theme.ts`提供canonical root color-scheme observation。Theme change不调用dispose/reset/clear/write/scroll/open/fit，不重建xterm或parser pump。retention evidence只由测试主动dispatch opt-in event取得同步snapshot，host不持久化新增的instance/color-scheme/buffer/cursor/selection attribute。
* CSS清理：删除`room.css`、`workspace-panels.css`、`workbench-responsive.css`及其imports，并从其他文件移除只属于本task outer surface的selector。

## 自审与直接修复

* P1：0 unresolved。
* P2：0 unresolved。自审发现删除`.terminal-view-slot[hidden]`后，utility `flex`会让hidden retained view在首次tab切换后参与布局，Shell宽度减半并触发PTY resize/prompt repaint；已在原slot恢复explicit hidden display，并由未放宽的historical-query/tab-switch oracle验证parser work与instance均不变。
* P3：0 unresolved。Settings button保持高于dismiss layer，<=640 tab保持122px；bare `.macro-workbench-shell`和generic `.inline-actions`双owner已移除或以`:where(.macro-panel)`等specificity-neutral selector收窄到`.003`consumer。terminal test state只在opt-in request时同步返回，不在parser hot path维护，也不向DOM复制最多1024字符selection，37 MB journey保持通过。
* 需要用户拍板：无。

## Legacy residue manifest

* `src/styles/base.css`只剩`:where(.macro-panel, .library-panel) button`；consumer为`MacroPanel`/`LibraryPanel`，归属`.003`。
* `src/styles/terminal.css`只剩`:where(.macro-panel, .library-panel) textarea/select`、`.macro-panel input`、`.macro-panel`及其header/section/row/form rules；consumer仅为Macro/Library subtree，归属`.003`。原generic `.inline-actions`已收窄为`:where(.macro-panel) .inline-actions`。
* 涉及outer wrapper的residue中，`src/styles/macro-chrome.css`只保留`.macro-workbench-shell .macro-panel`，`src/styles/workbench-shared.css`只保留`.macro-workbench-shell > *`及其Macro run-log descendant；这些consumer是`MacroPanel`/run-log内部，归属`.003`，不再存在bare outer-wrapper rule。
* 其余`src/styles/*.css`均为Macro/Library内部selector；扫描无App、Room、workspace outer、terminal/Text、Settings、notice、tab或resizer legacy owner。
* `src/framework.css`中的global rule逐项限定为：root theme color/font与terminal font variable、body既有margin reset、跨迁移阶段form font inheritance，以及无法写在source markup上的xterm runtime subtree geometry/viewport overflow bridge；没有固定light chrome color。

## Gate证据

* `just check`：TypeScript与Svelte均0 error、0 warning。
* `just build`：219 modules，production CSS 134.09 kB，build通过。
* `just test-20260722b-002`：27/27 unit、15/15 browser通过；覆盖DOM fingerprint、1600/900/720主矩阵、640/680/980/1100/1260精确inclusive边界及必要的`N+1`、5种代表theme、Home/Settings/notice、Room behavior、37 MB real PTY、reset、strict historical tab retention与`.009`computed-style oracle。
* `just test-20260722b-002-chrome`：3/3通过；`just test-20260722b-002-terminal-retention`：1/1通过。
* `just diff-check`通过；scope scan未发现backend/server/Room protocol、Macro/Library component内部markup或第二theme catalog修改。

## Full terminal audit例外

额外执行`just test-002`：14/14 unit、5/6 browser通过。唯一失败仍是`visited terminal views survive Shell and Text tab switches without replaying long history`的160k marker在20秒内超时；`.001` review已记录其在本任务之前的直接父revision `a4a4bbff`同样为5/6且37 MB journey通过。本change没有放宽该oracle或修改terminal runtime来掩盖它；task-scoped recipe仅按exact test title排除此父版本既有失败，并保留上述full audit结果。
