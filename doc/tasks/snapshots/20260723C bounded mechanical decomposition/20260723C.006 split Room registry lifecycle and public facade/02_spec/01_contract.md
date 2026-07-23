# Formal Contract

## 任务边界

允许新增`roomRegistryLifecycleCoordinator.ts`或等价模块。`terminalRoomManager.ts`继续是production唯一公开import facade，并原样re-export constants/types/helpers；现有25个consumer不迁移到private coordinator。

## 任务规范

### Registry与identity

* manager创建唯一`rooms`与`clients` map；coordinator只持有相同reference。
* `MAX_LIVE_ROOMS=32`与全部creation path的capacity guard不变。
* random Room ID、route token、Room generation各最多重试8次；collision/error不变。
* `ensureRootRoom`、`createRoom`、`ensureRoomFromRoute`、list/sort/summary返回值不变。
* Room summary继续实时投影terminal/client count与active-run provider。

### Lifecycle与destroy

* active/destroying/destroyed lookup及error保持。
* Destroy先校验roomId/generation/active，再capture previous controller并`beginRoomDestruction`。
* finish ports保持control-lost hook、destroy hooks、CWD cancel、backend close、client removal、Room removal的既有顺序。
* `destroying` single-flight集合只有一个owner；`destroyAllRooms`等待新启动和已有destroy promise。
* lifecycle ticket、terminal structure queue和run structure lock不复制。

### Facade与依赖

* public method signature、sync/async形态、return与error不变。
* control/backend/registry之间只通过manager wiring或明确ports依赖，不形成cycle。
* public callers继续无法取得private RoomRuntime/TerminalSlot mutation入口。

## 示例

正例：旧URL token指向已Destroy的Room。之后访问可用同token创建fresh generation，但不能恢复旧terminal/controller/run。

失败例：Destroy开始后已admit的async operation醒来。ticket必须因abort拒绝commit；Room从map移除后不能被continuation重新广播。

反例：registry coordinator新建自己的Room map并由manager定期同步，即使public结果暂时一致也构成双truth。

## 测试

* `terminalRoomManager032`冻结capacity、route generation、destroy/revisit和cwd/terminal public behavior。
* `terminalRoomDecomposition008`冻结single facade/map与lifecycle ticket。
* Room routing/lifecycle/WebSocket/real PTY integration及Home E2E冻结destroy drain。
* 增加private coordinator仅由manager消费及single registry oracle。
* 正式Gate：`just check`、build、focused unit/integration/Room E2E、`just diff-check`；本轮未执行。
