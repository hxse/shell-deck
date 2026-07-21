# Review Result

## 当前状态

`20260721A.010`实现、自审与整链closeout完成。四个共3288行的primary test文件已拆成17个journey/fault-domain文件和4个透明helper文件；最大journey文件为431行。没有修改production、active spec或冻结的`.031B`文件，也没有改变任何test title、用户步骤、timeout、route/fault ordering gate或断言。

## E2E文件映射

* Room 14项：`runner` 2项承接snapshot/delta/completed run，`runtime-input` 2项承接跨tab runtime/notification/input generation，`saved-content` 7项承接Save/Delete/Create/reconnect invalidation race，`takeover` 3项承接Home/controller/observer/lease feedback。
* Library 11项：`crud` 1项保留完整三kind UI/control inventory journey，`navigation` 1项承接lease release顺序，`races` 5项承接Save/Create/Delete commit gate与preserved buffer，`reconnect` 4项承接missed notice、retry、unload guard与panel memory。
* Macro 10项：`record` 2项承接record/JSON session，`flow` 1项承接nested visual editor，`layout` 4项承接Unassigned/reference/terminal layout，`feedback` 3项承接dirty Start、panel memory和delayed Prepare。
* `roomRuntimeSync035.helpers.ts`、`libraryWorkbench036.helpers.ts`和`macroWorkbench034.helpers.ts`只承接原有definition factory、locator/setup、clipboard/WebSocket capture与显式deferred gate；不封装完整journey或assertion。

## Integration文件映射

原`macroRuntime034.test.ts`的15项按连续fault domain迁移：`prepare` 5项、`execution` 4项、`lifecycle` 2项、`terminal` 2项、`durability` 2项。`macroRuntime034.helpers.ts`只承接原有Room grant、HTTP request、replay读取、definition factory、streaming fake backend、poll predicate和deferred gate；每个assertion仍留在唯一test case内。

## Parity与公开入口复核

`currentTestJourneyInventory010.test.ts`通过TypeScript AST读取17个目标文件，冻结50个唯一title、每个完整`test(...)` source hash、644个静态`expect`调用、27个route gate和20个wait/gate调用。按title排序后的总inventory SHA-256为`b47e58e82a8fbd5d56e104b1d40e2ed9f06d70d9eb7e3f34ec87b9870c562b0a`，与拆分前完全一致；原有一个`waitForTimeout(500)`原样保留，没有新增`.only`、`.skip`、retry或固定sleep。

`package.json`的`test:integration`和`test:031b`显式加载相应拆分文件；`test:e2e`沿用`.039`的Playwright目录级current `*.spec.ts`自动发现，因此拆分文件与`.038` AgentEvent E2E无需维护手写allowlist且不会被静默漏掉。旧四个primary路径无生产Gate引用，`.031B` historical source保持`.historical.ts`并由digest oracle冻结，current inventory仍由原`test:031b`入口执行。

## 自审结论

* P1：0。
* P2：0。
* P3：0。
* AI直接修：首轮曾通过文件名与公开入口顺序，让`runner`先清理由`roomLargeReplay`遗留的Room，再执行`takeover`中的Home inventory case；这会把测试正确性绑定到隐式顺序。继承`.039`目录级自动发现后，已删除该顺序依赖，在`takeover` spec的`beforeEach`显式清理live Room；50个原test body、source hash、fixture、sleep、断言与产品代码均未修改。`roomLargeReplay → takeover`故意相邻的8项逆向隔离Gate和完整53项current E2E均通过。
* 需要用户拍板：无。

## Gate结果

* 拆分前基线：15项macro runtime integration、35项目标E2E全部通过。
* 拆分后focused：结构parity 2项/68个expectation、15项integration/100个expectation、35项目标E2E全部通过；额外的`roomLargeReplay → takeover`隔离顺序8项通过。
* `just check`：最终通过，TypeScript与Svelte均为0 error / 0 warning。
* `just build`：通过，215 modules transformed，0 warning。
* `just test-unit`：176 unit/1021个expectation与53 integration/473个expectation全部通过；包含real PTY、Room/controller/lease、runner、Library及`.001-.009` boundary Gates。
* `just test-e2e`：既有closeout由Playwright目录级自动发现53项current Chromium测试并全部通过。finding修复后的同入口重跑为52/53；唯一失败是未被本轮修改的`.039` retained-view用例在宿主8核高负载下未能于20秒内消费完160k fake-terminal burst（消费持续前进，37 MB真实PTY仍通过）。本轮直接涉及的Library全journey、`.009` computed-style/720 px窄viewport以及`.038` AgentEvent均通过，未为环境吞吐调整timeout或产品代码。
* `just test-031b`：14项冻结/current inventory unit（340个expectation）与13项comprehensive Macro/Room/Library Chromium全部通过。
* 整链static：154个production TS/Svelte/CSS节点、468条relative import edge、0 cycle；整个change链production新增行无legacy/compatibility/migration/V4分支。
* `git diff --check`、conflict marker及`.orig/.rej/.bak`扫描通过；旧primary路径只保留在结构测试的absence assertion中。

## 文档同步

本任务只改变current test组织和公开test文件列表，不改变产品或测试语义，因此不更新`doc/tasks/active_specs/**`。本review、task index及父任务closeout记录最终边界和Gate证据。
