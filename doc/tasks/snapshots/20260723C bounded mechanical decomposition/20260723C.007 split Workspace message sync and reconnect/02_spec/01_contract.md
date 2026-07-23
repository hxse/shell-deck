# Formal Contract

## 任务边界

允许新增`roomWorkspaceMessageCoordinator.ts`与`roomWorkspaceReconnectCoordinator.ts`或等价模块。`createRoomWorkspaceState`的options、return getters/commands与Svelte consumer不变。

## 任务规范

### 单一rune truth

* `active/connected/connectionGeneration/roomGeneration/controlView/client/terminals/runner/content changes/selection`等rune只在factory声明。
* coordinator不得声明mirror `$state/$derived/$effect`，不得缓存Room snapshot、terminal list或runner snapshot。
* timer与sequence watermark可以由单一coordinator拥有；不得新增父版本没有的in-flight token、generation guard或async commit语义。

### Message synchronization

* `client_registered`、generation filter与RoomRevisionGate reset顺序不变。
* control/grant/lost、Room/terminal snapshot、output/replay/index/state/CWD的projection及revision acceptance不变。
* runner snapshot/delta继续只进入`RunnerRepairCoordinator`。
* content record/lease changes继续保留最近200项并使用单调sequence。
* notification delivery与Room Destroy处理不变。
* message coordinator只调用factory commit ports，不能直接创建socket/effect。

### Reconnect与control reclaim

* open递增connection generation一次、清timer并resume runner repair。
* close先清connected/control pending；4001或`room_destroyed`直接Home。
* 其他close按关闭时的roomId/generation读取`/api/rooms`；成功响应中Room消失则Home、仍存在则750ms single timer重连。network exception同样重连，但HTTP非成功或body `ok`为false继续直接返回且不建立timer。
* reload navigation且sessionStorage记住controller时开启5秒reclaim window；只在available view尝试acquire，不自动takeover observer。
* dispose继续由factory先将`active`置false，再清timer、runner repair、notification和client。close probe响应只保留父版本的active检查与schedule时active/roomId检查；control acquire完成后不新增token或generation复核。

### UI command

terminal create/close/drag/reorder/tab keyboard、mutation notice和confirm文案不变，仍在factory使用current rune truth。

## 示例

正例：`/api/rooms`返回503或`{ok:false}`时保持disconnected且不建立retry timer；network exception仍建立原750ms retry。

正例：reload后先收到available control view，reclaim用该epoch acquire；若已变observer，不自动takeover。

反例：message coordinator保存`terminals`副本后批量回写，或reconnect coordinator自行声明`connected` rune，均构成第二份truth。

## 测试

* `roomRevisionGate035`、`runnerSnapshotMerge035`、terminal view/state unit冻结projection。
* Room websocket/runtime sync/takeover integration与E2E冻结generation、reconnect、destroy、control reclaim。
* current comprehensive UI冻结terminal commands和return behavior。
* 新增factory sole-rune-owner、coordinator no-cache、父版本source order与close-probe failure matrix oracle。
* 正式Gate：`just check`、build、focused unit/integration/E2E、`just diff-check`；本轮未执行。
