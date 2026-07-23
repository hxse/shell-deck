# Implementation Review

## 总体判断

Finding成立且已修复。原`macroRunnerService.ts`以587行同时承载public API、Start/execute/finish、Pause/runtime Input与revisioned snapshot publication；本change把既有代码按domain直接移动，public facade降至92行，未增加产品语义或第二份runtime truth。

## 实现结果

* `MacroRunnerService`保留原constructor、11个public method、`MacroNotRunnableError` runtime export与`MacroStartPreflight` type export；public `start`继续保持async边界。
* `MacroRunnerLifecycle`为380行，唯一持有Room-to-`LiveRun` registry，原样保留Start lock/auth/manifest/first-event/install顺序、execute/finish与artifact callback。
* `MacroRunnerInteraction`为161行，不持有registry或snapshot cache，只原地操作同一个`LiveRun`的Pause waiter、pending input、abort与paused clock。
* `MacroRunnerPublication`为114行，唯一持有Room-local runtime revision；25ms timer仍存于同一live object，通过live getter选择current run并保持snapshot/delta watermark规则。
* `macroRunnerLiveState.ts`为95行，只定义并创建唯一live object；pending input、timer、artifacts与parallel progress没有mirror。
* source oracle冻结module consumer、single-state owner、public surface、Start/Input/publication phase order与所有相关文件400行上限；active run-log spec已同步ownership。

## Findings and Solutions

没有未解决P1/P2。实现中未发现需要改变现有event、error、status、protocol或test oracle的问题。

## 需要用户拍板

无。

## Gate结论

Close Gate：通过。

* `just check`：通过，style residue clean，TypeScript与Svelte均为0 error / 0 warning。
* `just build`：通过，214 modules transformed。
* `just test-20260723c-002`：逐文件顺序执行通过；11项unit、22项integration，共234个assertion。
* focused E2E：单worker Chromium Room runner/Input 4/4通过，覆盖delta gap repair、completed edit recovery、takeover/reconnect及input coalescing。
* line-size oracle：facade 92行、lifecycle 380行、interaction 161行、publication 114行、live model 95行、task unit 117行。
* `just diff-check`：通过。
* `jj`审计：`.002` snapshot后12个后继change自动重基，`.002-.014`全部`conflict=false`。

## 残余风险

无阻断风险。lifecycle保留380行是为了不拆开同一Start/finish transaction；继续把bootstrap阶段切成通用pipeline或event bus会扩大抽象面并弱化当前可读的point-of-no-return，因此不在本机械task继续拆分。
