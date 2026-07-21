# Contract

## 任务边界

### Added Semantics

无。

### Frozen Semantics

* `/` Home与`/<roomId>` route、random Room创建、capacity/error和Destroy行为冻结。
* Home可见时自动刷新、hidden cleanup、focus立即刷新和无手动Refresh行为冻结。
* Room WebSocket connect/reconnect/generation、controller acquire/takeover/release和readonly反馈冻结。
* terminal snapshot/revision merge、runner snapshot/delta/gap repair和content invalidation delivery冻结。
* Telegram/App/System notification去重与在线设备投递冻结。
* Macro/Library dirty/preserved buffer的beforeunload保护与Home清理对称性冻结。
* 既有DOM、CSS class、test id、文案、按钮位置和focus冻结。

### Primary file

`src/App.svelte`。

## 任务规范

### 目标模块

* `src/lib/components/RoomHome.svelte`：Home markup、registry list、New/Destroy入口；不拥有server state之外的产品真值。
* `src/lib/roomWorkspaceState.svelte.ts`：每个App实例一个Room connection state，拥有socket generation、controller view、terminal projection与content event forwarding。
* `src/lib/runnerRepairCoordinator.ts`：pure merge decision、single-flight/bounded retry和generation-bound resync状态。
* `src/lib/roomNotificationDelivery.ts`：browser-local notification id去重、App/System presentation与cleanup。
* `src/App.svelte`：route解析、Home/Workspace选择、state实例生命周期、顶层props/events和beforeunload聚合。

### State ownership

* server仍是Room、controller、terminal和runner唯一真值。
* `roomWorkspaceState`只保存当前连接projection，不持久化、不跨App singleton化。
* Macro/Library selection和draft仍由各Panel拥有；App只接收dirty boolean与server invalidation stream。
* runner repair只能通过现有HTTP snapshot和WebSocket delta收敛，不恢复周期polling。

### Svelte约束

* 新state module使用Svelte 5 runes，并暴露窄readonly projection与command methods。
* `$effect`的建立/cleanup次数与原App等价；每个timer、listener、socket handler必须有明确dispose。
* props/events不得通过隐式module singleton穿透组件。
* 抽组件不得改变实际DOM层级；必要wrapper必须证明不影响CSS/layout/accessibility。

## 示例

### 合法

App根据route创建一个room state实例，把snapshot与commands传给现有Workspace；离开Room时dispose socket/timer，并对称清除Macro/Library聚合dirty状态。

### 非法

* 创建全局`roomStore`让两个不同Room tab共享client state。
* 把Macro draft搬进Room state以“方便同步”。
* 把gap repair改回固定轮询。
* 抽`RoomHome`时改变按钮、文案或打开新窗口语义。

## 测试

### Unit

* runner merge/gap/retry、generation cancellation和notification dedupe继续通过。
* state dispose后timer/listener/socket callback不再提交。

### Browser E2E

* Home自动刷新、New/Destroy/容量与focus/visibility行为不变。
* 相同Room双标签的control、terminal、running/paused/waiting input、reconnect和toast行为不变。
* dirty/preserved Macro/Library在瞬时reconnect后仍有unload guard；真正回Home后无phantom guard。
* DOM/button inventory与20260627A.031B后继current baseline无意外差异。

### Gate

运行`just check`、build、runner snapshot unit、Room integration、`.035`双标签E2E、current comprehensive UI journey和`git diff --check`。
