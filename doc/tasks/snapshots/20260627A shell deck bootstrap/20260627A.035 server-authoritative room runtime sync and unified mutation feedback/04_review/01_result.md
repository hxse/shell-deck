# 20260627A.035 Review Result

## 当前状态

implementation-complete，Document/Code/Test Gate通过。

## 代码映射

* `src/lib/protocol.ts`、`src/lib/macro/runnerTypes.ts`：破坏性收口`runner_snapshot`、`content_record_changed`、`runtimeRevision`、`runningMacro`和server-owned runtime input；旧flattened snapshot与旧input submit body不再接受。
* `server/macroRunnerService.ts`、`server/httpServer.ts`：Room内存成为runner/runtime input唯一真值；连接时发送完整snapshot，状态变化主动publish，快速同步transition最多25ms合并；draft update/submit执行controller、Room generation、run、invocation和revision复核。
* `src/lib/terminalRoomClient.ts`、`src/App.svelte`、`src/lib/components/MacroPanel.svelte`、`src/lib/macro/macroRunnerClient.ts`：消费server push并忽略旧revision；Editing/Viewing Macro保持browser-local，Running Macro按Room snapshot只读呈现；正常runner polling删除，HTTP只保留Debug与event-gap repair。gap repair绑定Room/connection generation与本地token，single-flight每批最多三次（立即、100ms、300ms），耗尽后保留pending并仅由focus、reconnect或后续runner message继续。run终态只释放terminal structure lock，不释放Macro Edit session；同一controller tab reload按.033的5秒窗口执行普通re-acquire，恢复shared mutation而不提升observer或takeover live owner。
* `server/httpServer.ts`与Macro record transaction：成功Create/Save/Delete后广播generic saved-content invalidation；client把pending期间事件按sequence排队，operation settle后才replay并推进消费状态，刷新saved list但不改变selector或覆盖dirty/editing/lease-lost draft。首次Create已publish、但fresh-record lease未保留时使用独立的submitted-buffer preservation state，不把它误装成普通clean view；该状态同样阻止更高revision或Delete覆盖本地唯一副本，直到用户显式New/Select/Edit/Discard解决，并与dirty/JSON edit一起上报唯一`beforeunload` protection。相同或更旧revision是ack/stale event；更高revision与Delete即使早于旧HTTP response到达也不会丢失，旧response不能冒充当前saved truth。follow-up又把WebSocket reconnect冻结为显式connection generation：list/read使用独立单调generation，5xx/transport失败保留queue并有界重试，clean readonly selection才安装server truth；controller/reconnect抢在已commit Create response之前变化时仍关联fresh identity并进入preservation，避免重复Create。
* `src/App.svelte`：Home通过Svelte 5`$effect`在可见时每秒读取server Room registry，hidden时cleanup，focus/visibility恢复时立即刷新；手动Refresh已删除。
* `src/lib/sharedMutationFeedback.ts`、`src/lib/components/workspace/NoticeStack.svelte`及terminal/Macro入口：shared mutation的client预检查与server拒绝统一映射到3秒toast；hover暂停、mouseleave继续、outside click关闭且文字可复制。
* `src/App.svelte`、`src/lib/components/TerminalSlot.svelte`、`src/lib/components/TextBoxSlot.svelte`：observer对terminal create/remove/reorder/input/Text edit不再静默；Take Control文案明确共享terminal和active run不会丢失，browser-local未保存draft仍留在原browser。
* `server/notificationService.ts`、`server/macroRunnerService.ts`、`src/App.svelte`：Notify只在server执行一次；Telegram一次，App/System按`notificationId`广播给当时在线的每个Room client并由browser有界去重，晚加入client不补弹。
* `tests/integration/roomRuntimeSync035.test.ts`、`tests/e2e/roomRuntimeSync035.spec.ts`：覆盖双WebSocket/双标签页Start、takeover、Pause/Resume、Waiting Input、draft/submit、断开后server继续、重连snapshot、saved-content invalidation、Telegram exactly-once及Home自动刷新；saved-content deterministic race覆盖A Save已commit但response延迟、B takeover后更高revision Save/Delete、A settle后重放最终invalidation，以及自身相同revision ack不误报。首次Create另以延迟POST response复现fresh-record窗口，并在B真实commit更高revision或Delete后才释放A response，确认A submitted buffer与准确remote notice都保留；测试同时断言此时刷新/关闭被`beforeunload`保护，显式Edit latest或Select none后保护解除。所有ordering使用`route.fetch()`commit gate及revision/selector收敛，不用timeout猜测顺序。runner repair测试在WebSocket层丢弃全部非终态delta，使唯一终态delta必然形成gap，再固定注入首次GET 500；没有后续delta时仍由第二次GET自动收敛到completed。额外验证observer仍可本地Select Macro，Edit/New/Delete拒绝统一反馈，takeover后直接Delete并同步saved-record删除，以及completed后Macro editor/New terminal解锁、Edit session保留、controller reload恢复可写。
* `tests/e2e/macroWorkbench034.spec.ts`：继承回归覆盖Macro New/Select/dirty discard/Cancel/直接Delete完整状态机，确认Search不会隐藏当前选择；同时覆盖`.034`最终reference-driven hidden layout：selector只显示live `N · type`，显式选择派生连续prefix，删除引用回收unused tail，terminal event零draft mutation，Send/Input/Wait/Capture/Parallel共用同一规则，If/Elif/Extract不生成future artifact引用。
* `tests/ui-baseline/031B/controlInventory.ts`、`tests/e2e/comprehensiveUiBehaviorCurrent.spec.ts`、`tests/e2e/comprehensiveMacroUiBehaviorCurrent.spec.ts`：历史`.031B`/`.034`snapshot保持不动；`.035` current inventory为174个source controls、0个unidentified controls，唯一预期删除是Home手动`Refresh`。两条current journey继续覆盖真实Room lifecycle及从空状态纯UI构建和运行复杂Macro。

## Gate

* `just check`：通过，TypeScript与Svelte均为0 errors、0 warnings。
* `just build`：通过，181 modules；JS bundle 584.88 kB，gzip 163.77 kB。
* `just test-035`：通过；118 unit、33 integration、27 Playwright E2E全部通过。该入口包含`.032-.035`完整回归面、pending Save/Create invalidation replay、reference-driven hidden layout与37 MB PTY/replay测试。
* `just test-031b`：通过；9个inventory assertions、2个Chromium current journeys全部通过。
* 临时dogfood：`/tmp/shell-deck-dogfood-20260716-7BwXhF`在最终`.034`父revision上重跑通过真实PTY复杂Macro与同URL三标签生命周期；先以UI复现Send→3次New shell，确认Target只列出`1/2/3 · shell`且terminal event不写layout，再显式选择terminal 3派生连续prefix；随后运行Parallel/capture/extract/text-list/If/runtime Input/Notify，Take Control后继续，重连得到completed snapshot，最终文件为`DOGFOOD_RESULT=PASS`且event log包含`run_completed`。
* hard-cut scan：通过；正常runner没有polling，旧flattened input snapshot字段不存在，Home没有手动Refresh；唯一runner Refresh位于明确的Debug fallback。
* `git diff --check`：通过。

## Finding

* P1：0。
* P2：0。
* P3：production JS仍超过Vite默认500 kB warning；这是继承的非阻断bundle风险，本任务没有借runtime sync重做chunk布局。
* `.036`继续只负责Library业务UI/CRUD/Load/search，并复用本任务的content invalidation、single-writer guard和mutation feedback，不复制另一套同步机制。

## 漂移分类与修复

* 预期变化：Home手动`Refresh`删除；saved Macro的Save确认改为server-authoritative异步返回。测试在本change只更新这两项，不改变其余`.034`用户流程。
* 非预期漂移：`flushRunnerInputDraft()`在`runnerInputDirty === false`时会同步完成内部async operation；旧写法先在内部`finally`清空promise、再由外层赋回已经resolved的promise，导致第二次Input invocation永远误判为“已有flush在途”，`fill`后立即Submit既不发送draft也不提交。实现改为先保存operation identity，再在外层identity-safe `finally`清除；完整UI dogfood保留即时Submit顺序并验证第二次Input，不靠延时规避。
* 非预期漂移二：published-Create buffer虽然不会被remote invalidation覆盖，但最初未进入App的dirty聚合，关闭页面仍可能丢失唯一副本。`MacroPanel`现在把preservation state一并上报，且E2E证明remote Save/Delete后guard生效、显式resolution后解除。

2026-07-20 `.032–.034`底座重写后的conflict-resolution复审逐文件保留本任务server-push/runtime-input/content-invalidation语义，同时接入父change的Text revision、published commit lease outcome与runner durable safety。Input submit现在先append durable event，再清pending/resume；append fault保留同一invocation可重试。Macro Update/Delete在record已publish而lease-state维护失败时仍向所有client广播authoritative `content_record_changed`，HTTP返回lost lease outcome，编辑端转read-only；不会出现磁盘已更新但UI收到假失败。Text observer denial继续走统一toast，但controller保留`.032`单in-flight/latest write coalescing。

本次解冲后验证：`just check`为0 error/0 warning；定向18项runner/runtime integration+unit与`roomRuntimeSync035.spec.ts` 13/13先行通过；随后`just test-035`完整通过132 unit、38 integration、32 Chromium，覆盖双标签页、takeover、runtime Input coalescing、reconnect、published-Create保存与lease-loss只读。Macro published update/delete fault test同时断言authoritative HTTP truth与saved/deleted broadcast。

2026-07-21 durable-event follow-up重基后，`just test-035`完整通过142 unit、40 integration、33 Chromium；其中`roomRuntimeSync035.spec.ts`为14/14。新增确定性gap测试证明首次repair GET返回500且之后没有任何runner delta时，client仍自动重试并安装server终态；三次失败后的pending continuation边界已同步到task与active specs。
