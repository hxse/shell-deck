# Review Result

## 当前状态

`.039`已落地并通过Close Gate。tab切换现在只改变pane可见性，不再销毁xterm/Text editor或重新解析完整replay；server terminal runtime、Room revision和PTY protocol没有修改。

## 根因与代码映射

* `src/lib/components/workspace/WorkspaceShell.svelte`删除active-only `{#if}` + terminalId `{#key}`生命周期，改为lazy retained id集合和stable keyed each。当前active或此前访问过且仍live的terminal才mount；inactive wrapper使用`hidden`，collection删除会立即销毁对应view。
* 未访问terminal仍不mount，避免把一个Room内全部大历史在首次连接时同时hydration。retained lookup使用Set，不让每帧terminal output退化为visited×terminal线性查找。
* `src/lib/components/TerminalSlot.svelte`增加active view输入；hidden Shell继续消费live parser delta，但跳过host尺寸测量和PTY resize。重新active后在下一animation frame做必要fit，尺寸未变化时不调用xterm resize。
* `src/styles/terminal.css`只增加占满stage的view wrapper及hidden规则；terminal/tab/header现有视觉、label和spacing未改变。
* Text pane通过同一stable wrapper保留textarea DOM、scroll position和single-in-flight local write state。

## 测试修正

* `roomLargeReplay032.spec.ts`新增160k历史、lazy Text mount、同一Shell host probe、hidden live output、三次Shell/Text往返、parser work不增加、240行Text scroll保留和terminal delete cleanup。
* 历史DA/cursor/OSC query测试改用真实page reload触发hydration；确认reload期间零`terminal_input`，之后tab切换复用同一host且同样零输入。
* `roomHome032.spec.ts`和current comprehensive journey按terminalId定位pane label。retained hidden pane进入DOM后，测试不再依赖“页面中永远只有一个label”的旧实现细节。
* 目录级full E2E最初稳定得到52 pass、1 fail；唯一失败是`.031A`历史journey仍以`comprehensiveUiBehavior031B.spec.ts`进入current discovery，并在已经删除的`/?configId=`与`.brand-line`入口失败。这不是产品回归，而是historical/current测试身份混淆。
* 历史journey原文改名为`comprehensiveUiBehavior031B.historical.ts`，byte digest仍为`358c2f4cb913d9f9f132ae770015a502dd07f02c752b5259b06e836d508160bc`；新增unit oracle同时固定digest并禁止同名`.spec.ts`重新进入current discovery。
* `test:e2e`删除人工文件allowlist，改为Playwright默认发现全部current specs；新增current journey不再可能因为忘记维护脚本清单而静默漏出Gate。

## Gate证据

* `just check`：TypeScript通过；Svelte为0 error、0 warning。
* `just build`：188 modules，全部chunk低于500 kB，0 warning。首次受限sandbox invocation在Vite transform前无输出卡住并被终止；同一正式recipe在本机验证边界重跑后5.03秒通过。
* 完整`roomLargeReplay032.spec.ts`：5 pass，包含37 MB真实PTY burst、reset replace、reload hydration与retained-view回归。
* `just test-unit`：151 unit、53 integration全部通过。
* `just test-e2e`：52个current Chromium E2E全部通过。
* `just test-039`：公开聚合入口再次执行同一组151 unit、53 integration、52 current Chromium E2E，全部通过。
* `just test-031b`：14 inventory unit（340个expectation）、13 current Chromium journey全部通过。
* 最终Set lookup小改后再次执行`just check`与核心retained-view Chromium test，均通过。
* `just diff-check`：通过。

## 审阅结论

* P1：0；P2：0；Close Gate blocker：0。
* 修复保持browser-to-server真值方向不变，没有新增server state、protocol message、兼容分支或持久化。
* full E2E不再把明确过期的历史contract伪装成current产品断言，也没有通过skip、retry或修改旧断言隐藏失败；historical source由byte oracle继续冻结。
* visited terminal会在当前Room页面生命周期内保留一个本地view，这是消除tab切换rehydration所需的明确成本；未访问terminal仍lazy，terminal删除/Room退出会释放资源。本任务不引入会重新制造历史回放的LRU eviction。
* 未运行真实Codex或外部服务；离线Fake长历史与真实PTY query/burst覆盖了本问题所需的xterm生命周期和parser行为。
