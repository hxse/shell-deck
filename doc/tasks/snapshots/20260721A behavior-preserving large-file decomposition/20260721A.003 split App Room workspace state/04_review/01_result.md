# Review Result

## 当前状态

`20260721A.003`实现与自审完成。`src/App.svelte`由857行缩至211行，只保留URL route、Home/Workspace composition、browser settings、notice presentation和Macro/Library dirty aggregation；Home refresh、per-App Room projection、runner repair与browser notification delivery已拆入任务约定模块。没有URL、WebSocket/controller、terminal/runner、notification、dirty guard、DOM或样式行为变化。

## 实际代码映射

* `src/lib/components/RoomHome.svelte`：承接原Home markup、Room list/capacity、New/Destroy和visible/focus/1秒自动刷新 lifecycle；组件根节点仍是原`main.room-home`，没有新增DOM wrapper。
* `src/lib/roomWorkspaceState.svelte.ts`：每次App Room实例创建一份rune state，承接socket/reconnect、controller reclaim/takeover、terminal projection、content invalidation、browser-local terminal selection与Workspace commands；没有module singleton或持久化live state。
* `src/lib/runnerRepairCoordinator.ts`：承接原single-flight、三次bounded retry、100/300ms delay、generation/token/abort guard和full snapshot/delta merge。
* `src/lib/roomNotificationDelivery.ts`：承接原notification key去重、500项窗口、App toast、System fallback和browser audio delivery。
* `src/App.svelte`：保留route、settings、NoticeStack、Workspace props/events和唯一beforeunload dirty聚合，并在销毁时显式dispose当前Room state。
* `tests/unit/runnerSnapshotMerge035.test.ts`：增加transient retry、connection-generation suspend和notification dedupe/reset characterization。
* `.031B` UI inventory：保留`.038`的199-control历史digest，新增`.003`仅因Home control source path移动产生的current digest；runtime control inventory没有增删。

## 自审结论

* P1：0。
* P2：0。
* P3：0。
* AI直接修：自审时给App补`onDestroy -> workspace.dispose()`，使reconnect/control/repair timer和socket在组件销毁前同步失活；删除一个未消费的runner coordinator方法；保留`.038`历史UI digest后另记`.003` path-only digest。
* 需要用户拍板：无。

逐项核对确认保留在App或直接移动的11个无适配函数体逐字一致。Room message dispatch顺序、roomGeneration过滤、revision gate、terminal merge、content sequence窗口、controller memory、runner retry条件和notification delivery statement顺序均保持。抽取只把直接state写入替换为同一实例内的closure写入，把App notice/route/settings读取变成显式callback。

依赖方向为`App -> RoomHome/roomWorkspaceState -> runnerRepairCoordinator/roomNotificationDelivery`；底层模块不反向import App或Workspace组件。所有rune state均在factory内部创建，未导出global store。socket、focus/visibility listener、interval、reconnect/control/repair timer和AbortController均有effect cleanup或显式dispose；Macro/Library draft仍由原Panel拥有。

## Gate结果

* `just check`：通过，TypeScript与Svelte均为0 error / 0 warning。
* `just build`：通过，197 modules transformed。
* `just test-unit`：最终156 unit与53 integration，0 fail；新增coordinator/notification characterization通过。
* `just test-e2e`：dispose修正后完整50项Chromium E2E全部通过，覆盖Home、Room双标签、controller reclaim/takeover、terminal replay、runner gap repair、notification、reconnect及dirty guard。
* `just test-031b`：13项source/runtime inventory unit和13项current comprehensive Chromium UI journey全部通过；control count仍为199、无unidentified control。
* `git diff --check`、内部依赖、singleton、重复旧state及`.orig/.rej`扫描：通过。

## 文档同步

本任务只改变browser内部源码归属，active specs中的Room、controller、runner、notification和UI contract均未变化，因此不改写`doc/tasks/active_specs/**`；本review与task index记录新的实现边界。
