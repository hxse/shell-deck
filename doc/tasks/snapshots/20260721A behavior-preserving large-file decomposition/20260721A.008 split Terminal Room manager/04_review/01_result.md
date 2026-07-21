# Review Result

## 当前状态

`20260721A.008`实现与自审完成。`server/terminalRoomManager.ts`由1453行缩至1158行，继续作为HTTP、WebSocket、runner与PTY backend的唯一公开facade，并独占live Room registry、broadcast wiring和coordinator composition。Room/terminal contract及既有功能未改变。

## 实际代码映射

* `server/terminalReplayBuffer.ts`：承接Shell bounded UTF-8 replay tail、Text full-state replacement、物理compact和output activity revision推进；不访问Room或broadcast。
* `server/terminalRuntimeState.ts`：承接Shell/Text runtime discriminated state、create/restart revision初值和closed/failed状态更新；resource handle仍由Room record拥有。
* `server/terminalSnapshotProjection.ts`：从同一authoritative Room/runtime生成room、terminal、replay、state、index map与position wire projection；全部为只读投影，不推进revision。
* `server/roomLifecycleCoordinator.ts`：承接Room record初始化、operation ticket、active→destroying→destroyed、in-flight drain及backend/client cleanup；不持有Room registry副本。
* `server/terminalMutationCoordinator.ts`：复用Room record上的唯一`structureQueue`，承接serialized operation、create/restart/move/close commit及runner structure lock状态推进；不建立第二个mutex。
* `server/terminalRoomManager.ts`：保留public API、Room/client registry、controller guard、PTY callback identity复核、cwd刷新、backend wiring、broadcast及上述模块组合。
* `tests/unit/terminalRoomDecomposition008.test.ts`：新增5项、30个assertion，冻结replay/runtime/projection/lifecycle/mutation与同Room queue顺序。

## Ownership与行为边界复核

源码扫描确认生产代码只有`TerminalRoomManager`组合新模块；HTTP、WebSocket与runner仍只依赖manager facade。新模块没有shadow Room map、第二套broadcast或独立revision counter；lifecycle与mutation共享manager所持Room record及其唯一`structureQueue`。

create/restart仍在candidate backend成功启动且ticket复核后提交；旧launch callback仍由manager的Room generation、terminal id、object identity复核挡住。create/insert/delete/reorder/restart、structure lock、room/terminal/text/output activity revision推进点与broadcast顺序均保持原位。Room snapshot仍先同步刷新cwd，再执行pure projection。

Destroy仍先清空controller、进入destroying并abort，随后按既有顺序执行control-lost hook、当前destroy hooks、ticket drain、terminal resource close、backend drain、client通知/关闭和registry移除。replay byte cap、UTF-8 tail、Text不截断、PTY output与terminal response filtering均未改动。

## 自审结论

* P1：0。
* P2：0。
* P3：0。
* AI直接修：首轮抽取曾在Destroy开始时捕获`destroyHooks`数组，早于原实现读取时点；已改为在control-lost hook完成后通过getter读取，恢复原时序。另恢复invalid expected structure revision在Room lookup前fail的既有错误优先级，并补回projection内部terminal lookup原有的ID校验边界。
* 需要用户拍板：无。

## Gate结果

* `just check`：通过，TypeScript与Svelte均为0 error / 0 warning。
* `just build`：通过，215 modules transformed。
* `just test-unit`：173 unit与53 integration，0 fail；覆盖real PTY lifecycle/input/output/resize、Room routing/multi-client、Text delayed echo、Prepare/runner、quiet activity与旧launch隔离。
* `just test-e2e`：50项Chromium全部通过；包含Room双标签single-controller、显式Prepare/runner、37 MB真实PTY、Shell/Text tab切换及historical terminal query/TUI response filtering回归。
* `git diff --check`：通过；`.orig/.rej/.bak`扫描无遗留。

## 文档同步

本任务只改变Terminal Room内部源码归属，不改变Room、terminal、controller、runner、replay或wire contract，因此不改写`doc/tasks/active_specs/**`；本review与task index记录新的实现边界。
