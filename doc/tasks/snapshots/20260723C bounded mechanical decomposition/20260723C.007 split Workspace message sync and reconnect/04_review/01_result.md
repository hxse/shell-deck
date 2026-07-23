# Implementation Review

## 总体判断

Finding成立且已修复。原`roomWorkspaceState.svelte.ts`为461行，同时拥有全部Workspace runes、20类ServerMessage routing、WebSocket reconnect/control reclaim和terminal UI commands。本change把message synchronization与reconnect coordination直接移入两个plain TypeScript coordinator，factory继续是唯一rune/public assembly owner，未改变options、return surface、protocol、DOM或terminal command。

## 实现结果

* `createRoomWorkspaceState`继续唯一声明17个`$state`、2个`$derived`与3个`$effect`，继续创建`TerminalRoomClient`、`TerminalViewStateStore`、`RoomRevisionGate`、runner repair和notification delivery。
* `RoomWorkspaceMessageCoordinator`只持有factory callback ports与两个单调content sequence；client registration、generation filter、control、terminal、runner、content、notification和Destroy分支保持原顺序。它不创建socket/effect，也不缓存Room snapshot、terminal list或runner snapshot。
* `RoomWorkspaceReconnectCoordinator`只持有750ms reconnect timer、5秒control reclaim timer与session intent。open只递增一次connection generation并resume runner repair；close继续按关闭时的Room/generation probe，Destroy/缺失进入Home，live Room或network exception安排single retry，HTTP非成功或body `ok`为false继续直接返回。
* close probe、retry timer与control acquire精确保留父版本检查点：成功probe响应检查active，schedule检查active/roomId，control acquire await后不新增token或generation复核。
* connection reset、Room revision acceptance、terminal projection、runner repair、最近200项content changes、public return和terminal UI command仍由factory live rune truth驱动。
* 新source/runtime oracle冻结sole-rune ownership、依赖方向、无cache边界、reset/message/open/close/dispose顺序、public surface、storage/timer常量、200项sequence、父版本probe failure matrix和400行上限。
* `just test-20260723c-007`已加入默认focused入口；新unit也已进入`test:unit:core`。
* active architecture与Room terminal contract已同步前端Workspace ownership。

## Findings and Solutions

审查发现并直接修复两项问题：

* P2：第一版拆分把HTTP非成功或`ok !== true`从父版本的直接返回改成750ms retry，并为close probe/control acquire增加了父版本不存在的continuation token与generation guard。虽然这些属于合理bug fix，但越过本机械task；最终实现已恢复父版本failure matrix、检查点和await后写入语义，后续如需修复必须另立正式行为任务。
* P3：第一版拆分让message coordinator直接依赖reconnect/runner/revision/notification concrete class，虽未复制state，但弱化“只经factory commit ports”的边界。已改为窄live callback ports，production中两个新coordinator都只由factory消费。

没有未解决P1/P2。

## 需要用户拍板

无。

## Gate结论

Close Gate：通过。

* `just check`：通过，style residue clean，TypeScript与Svelte均为0 error / 0 warning。
* `just build`：通过，216 modules transformed，3.03秒。一次sandbox内build启动后无进展并主动中止；确认无残留进程后在sandbox外重跑通过。
* `just test-20260723c-007`：恢复父语义后顺序执行通过；19项unit、3项integration、8项single-worker Chromium E2E，共220个Bun assertion。
* line-size oracle：factory、message coordinator、reconnect coordinator与task unit均低于400行。
* `just diff-check`：通过。
* `jj`审计：当前change为`.007`；`jj status`自动重基7个后继change，`.007-.014`的`conflicts()` revset为空。

## 残余风险

无阻断风险。WebSocket构造/effect和所有user-visible runes刻意留在factory，两个coordinator只承接本task冻结的routing/timer coordination；继续移动terminal UI commands或建立第二份Workspace session会越过本机械拆分边界。
