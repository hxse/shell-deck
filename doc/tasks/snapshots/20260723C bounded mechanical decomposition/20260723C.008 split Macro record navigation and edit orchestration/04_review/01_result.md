# Implementation Review

## 总体判断

Finding成立且已修复。原`macroRecordSession.svelte.ts`为691行，在唯一rune owner内同时实现list/navigation、New/Select/Library Load、Edit/Cancel/Save/Delete、JSON Save、dirty Start record resolution与operation identity。本change把request orchestration直接移动到两个Macro-specific plain TypeScript模块，factory降至398行并继续独占全部record/draft/lease/feedback runes、public return与最终commit。

## 实现结果

* `createMacroRecordSession`继续唯一声明17个`$state`与4个`$effect`，继续装配MutationWorkflow、RemoteSync、JSON session ports及全部public commands。
* `MacroRecordNavigationCoordinator`为158行，只持有list generation；list stale/retry、Select/null selection、dirty discard、New和Library Load均保留原request/release顺序。Library Load结果仍由factory复核九项primitive identity后决定安装或仅提示created record。
* `MacroRecordEditOrchestrator`为342行，没有timer、rune或record cache；fresh Edit lease、Cancel release、Save/Create/Delete、Save to Library、JSON Save和dirty Start只保留单次调用局部snapshot。
* MutationWorkflow与RemoteSync未复制或改写。persist transaction的typed callback仍同步进入factory的`acceptPersistOutcome`，因此retained lease和published Create identity不会被外层await间隙延迟。
* factory继续唯一执行template/record/draft/lease/dirty/preservation/label/error commit，并在每个async结果后复核operation/controller以及对应record/draft/JSON/lease identity。
* options、exports、return getters/commands、confirm与error文字、JSON failure buffer、DOM和Svelte consumer均未改变。
* `macroInvalidationQueue004`新增sole-rune owner、module consumer、no-cache/no-generic、operation token、phase order、published-Create callback、Library identity、public surface与400行oracle。
* 新增`just test-20260723c-008`作为后续focused入口；active architecture、Macro与Library contracts已同步实现ownership。

## Findings and Solutions

审查中发现并直接修复：

* P2：第一版抽取曾先把MutationWorkflow commit callback保存为orchestrator局部值，再在外层`await`返回后调用factory。这样会把retained lease/published Create关联推迟一个microtask，给controller/editor identity变化留下错误窗口。现已在原commit callback同步调用factory typed commit port，再把结果返回给后续install phase，恢复父实现时序。
* P3：edit orchestrator初稿保留了一个未使用的navigation identity type import；已删除。

没有未解决P1/P2。

## 需要用户拍板

无。

## Gate结论

Close Gate：通过。

* `just check`：通过，style residue clean，TypeScript与Svelte均为0 error / 0 warning。
* `just build`：通过，218 modules transformed，3.05秒。
* `just test-20260723c-008`所列命令逐项顺序执行通过：21项unit、3项integration，共237个assertion。
* focused E2E：18项single-worker Chromium通过，覆盖CRUD、JSON failure buffer、dirty Start、New/Select/Delete、Library Load、published Create races、control change、reconnect与comprehensive Macro journey。
* line-size oracle：factory 398行、navigation coordinator 158行、edit orchestrator 342行、task unit 310行。
* `just diff-check`：通过。
* `jj`审计：当前change为`.008`；`jj status`自动重基6个后继change，`.008-.014`的`conflicts()` revset为空。

## 残余风险

无阻断风险。398行factory主要是17个rune、effects、typed commit state table、operation gateway与既有public return；继续把这些commit写入移出factory会制造第二份state-machine truth，不属于本机械拆分边界。
