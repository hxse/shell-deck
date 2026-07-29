# Review and verification

## 总体判断

20260729A已经把唯一current Macro schema破坏性切换为`MacroDefinitionV6`，并把Parallel收口为显式target Action组成的并发pane。旧lane terminal、固定final Output、merge与`merged_text`均已从schema、visual authoring、runtime、artifact choices和current docs删除；V5只作为invalid-record/legacy rejection反例存在，不读取、不迁移、不dual-run。

Shell ownership、Text exclusive/shared分类、selector disabling、状态badge、help和runtime send plan共同消费`parallelTerminalUsage.ts`这一份pure policy；visual editor按reactive draft revision只建立一个derived usage index。Shared Text由每次Parallel invocation创建的per-target queue实时append：pane order等待缺失前序并即时drain ready follower，completion order按触发顺序写入；多个Text target互不阻塞。Parallel外部Flow仍在全部pane自然结束后继续，不存在Join schema或隐式artifact。

代码、文档、focused/full Gate和current UI oracle一致。最终自审未发现遗留P1/P2/P3，可以关闭并进入后续change。

## Gate结论

Formal Document、Execution、Code、Focused Test、Current Docs与Overall Close Gate全部通过。

* `just check`：通过；371个project-authored code文件全部不超过400行，exceptions为0，19个350行soft advisory；UI style residue clean；TypeScript与Svelte为0 error / 0 warning。
* `just build`：通过；Vite 7.3.6共transform 414 modules，production build 4.35秒完成。
* `just test-unit`：通过；各阶段合计366 tests，其中current core为283，默认入口内的完整integration block为60。
* `just test-integration`：60 tests通过。
* `just test-20260729a`：47 unit、7 integration、3 Chromium E2E通过。
* `just test-e2e`：75 Chromium E2E通过，单worker，4.6分钟。
* `just diff-check`：通过。
* jj change `nxutvtll`：`conflict=false`，parent保持`yntnmrrs`。

第一次在sandbox内独立执行`just build`时，Vite在transform输出前持续两分钟无进展，因此主动中止，避免继续占用机器；随后在sandbox外以完全相同源码串行重跑，4.35秒通过。全部build/test命令均按顺序执行，没有并发重命令。

## 实现审查

### Schema、validation与artifact边界

`MacroDefinitionV6`要求每个terminal-bearing pane Action保存自己的`MacroTerminalReference`，Parallel要求`sharedTextOrder`，empty pane合法。Parallel pane只接受Send、duration/terminal-quiet Wait、非structured Capture、Extract与Notify；Input、user-continue、structured-json和control nodes fail loudly。

同一Shell只能由一个pane引用；同一Text跨pane后自动成为shared，且所有pane内引用必须是Send append。Capture/Extract artifact只在同一pane更晚Action中可见；outer artifacts可供pane读取，sibling和Parallel外看不到pane-local artifact，Parallel自身不产生artifact。

V5、lane terminal、Output、merge、missing order与`merged_text`均有negative regression。Macro list继续隔离invalid V5 record而不隐藏valid V6 records。

### Queue与runtime边界

`ParallelSharedTextQueue`按terminal index保存独立target state，并为Shell/exclusive Text保存同一invocation direct-write ledger。Pane-order plan严格按`lanes`数组和各`body`数组展开；expected ordinal立即写入，later ordinal等待，成功append后推进cursor并连续drain。Completion-order target保存同一静态plan，但按dispatch顺序同步写入；两种模式都校验plan membership与最终完整性。

terminal mutation和`terminal_input_sent` durable event被拆成`write`/`record`两个可重试阶段。write失败不提交ledger；write成功而event记录失败时，Resume只补event，不重复Shell或exclusive/shared Text side effect。Send在真实write完成前不会完成，因此同pane后继Action不能越过它。

每次Parallel invocation创建local AbortController，并把signal传入pane Action和queue。`onLaneFail:"pause"`保留signal、progress和queue waiter并重试失败Action；Fail、Action finish、Stop、Room Destroy与run abort会先取消sibling Action及未完成waiter，再等待settlement和传播原始outcome。已经append的partial Text不回滚，unbounded AgentEvent Capture不再阻止run terminalize。

### UI与authoring边界

Parallel header保留pane tabs、Add/Remove pane与On pane fail，并新增`Shared Text order`。每个Action card拥有自己的Target/Source selector；旧Lane result、Collect、Output和Merge controls已删除。状态文案固定为：

* `Exclusive Text`
* `Shared Text · pane order`
* `Shared Text · completion order`
* `Shell · owned by <laneId>`

Help使用theme-native可交互details，支持hover/focus/tap；Shell owner在其他pane selector中disabled，Text可以显式共享。Visual mutation仍通过唯一draft gateway；为使empty draft也能选择已有live terminal，selector policy复用`projectRuntimeTerminalLayout`先投影candidate layout。Parallel parent只创建一个reactive derived usage index，badge按action id、selector按terminal index读取同一投影，没有第二份rune state或per-control全量扫描。

## Findings and Solutions

实现与自审期间发现并修复五项：

1. Empty `terminalLayout`下，Parallel selector最初直接用persisted layout判断candidate，导致所有live terminal被误禁用。最终抽取pure `projectRuntimeTerminalLayout`，authoring adoption与Parallel availability共享同一投影规则，并增加empty-draft回归。
2. Comprehensive journey的Beta pane在Shell Send后立即Capture，真实PTY输出尚未进入buffer，导致共享Text只出现Alpha。这不是queue丢写；测试改为显式`Send → duration Wait → Capture → Send Text`，随后Alpha/Beta均通过真实browser/runtime路径。
3. Completion-order queue最初只保留committed sets，没有冻结plan membership或在finish验证完整性。最终两种order都持有静态plan并fail loudly拒绝未知step或不完整target。
4. Pane Action触发`finish`时，Parallel最初会把`MacroFlowSignal`包装成`parallel_lane_failed`。最终在lane failure分类前传播Flow signal、取消其他waiter，并增加finish回归。
5. Retry回归最初只覆盖event record失败。最终补充append失败不推进cursor、Pause重试drain、Stop保留已提交partial Text与multiple target独立queue测试。
6. Closeout复审发现Fail/Finish只取消shared Text waiter，unbounded sibling Capture会令run永久停在running。最终增加invocation-local cancellation scope，覆盖pane Action与queue；focused unit和真实server integration同时冻结fail/finish/Stop取消、Pause不取消。
7. Closeout复审发现direct Shell/exclusive Text缺少retry ledger。最终把所有pane Send纳入同一invocation的`written/recorded`状态机，并冻结event append失败后只补record、不重复terminal input。
8. Closeout复审发现每个Action/terminal candidate重复构造完整usage。最终由Parallel parent按reactive draft构造一次derived index，controller、badge与selector共用，并增加ownership source regression。

修复后未发现待处理Finding。

## 需要人工拍板

无。

## AI可直接修

无待修项。

## 未覆盖与残余风险

自动化不承诺替用户清空Text、隔离Parallel之外的并发Text编辑，或回滚已经append的partial result；这些都由frozen contract明确排除。Shared Text ordering只覆盖同一次Parallel invocation内的Send append。真实Shell输出仍需要用户用Wait或AgentEvent等显式Action定义等待边界；Send只承诺terminal input已提交，不承诺外部程序已经产生输出。

## 审阅范围

审阅范围包括20260729A全部task文档、V6 schema与validators、artifact visibility、visual/JSON authoring、pure terminal usage policy、shared Text queue、runner pause/failure/abort路径、Text incremental transport、current active specs/Quickstart/README、control inventory、structure/theme oracle、focused/full unit/integration/E2E与jj change边界。
