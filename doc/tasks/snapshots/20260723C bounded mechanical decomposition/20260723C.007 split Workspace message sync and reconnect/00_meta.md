# 20260723C.007 Split Workspace Message Sync and Reconnect

## 任务概括

`src/lib/roomWorkspaceState.svelte.ts`当前461行，factory同时声明全部workspace runes、路由每种ServerMessage、创建/重连WebSocket、恢复controller intent并暴露terminal UI commands。本task抽message和reconnect coordination，factory继续是唯一rune/public assembly owner。

## 正式 task 级别及定级原因

三星任务。Room generation/revision、terminal replay、runner delta repair、saved-content invalidation与controller reclaim在同一socket上交错；stale message或旧async reconnect若写入新generation，会造成quietly wrong browser state。

## 范围内

* 新建无rune的message synchronization coordinator。
* 新建connection/reconnect/control-reclaim coordinator，只移动既有timer与session intent协调状态，不增加新的continuation语义。
* factory继续唯一声明/写入workspace user-visible runes，并保留原return surface。
* 所有文件不超过400行。

## 范围外

* 不改protocol、TerminalRoomClient、runner repair、notification delivery或terminal view primitive。
* 不改变DOM、App props、Room route或browser storage key。
* 不把Workspace state移入global store或第二个Svelte session。
