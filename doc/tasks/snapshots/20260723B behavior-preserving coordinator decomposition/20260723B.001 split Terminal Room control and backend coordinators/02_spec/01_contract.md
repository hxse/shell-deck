# Formal Contract

## Public facade

`server/terminalRoomManager.ts`继续是production唯一导入入口。`TerminalRoomManager`现有constructor options、public properties、methods、return/error语义全部保留；`DEFAULT_REPLAY_BYTE_LIMIT`、`ROOM_CONTROL_HEARTBEAT_MS`、`ROOM_CONTROL_TTL_MS`、`RoomClient`、`RoomLifecycle`、`RoomOperationTicket`与`RoomControlledOperationTicket`继续从原文件导出。

`roomControlCoordinator.ts`与`terminalBackendCoordinator.ts`是manager内部implementation modules。除对应module-boundary unit test外，server/src production不得直接import其class。

## State ownership

manager创建并拥有唯一`rooms: Map<string, RoomRuntime>`与`clients: Map<string, RoomClient>`。coordinator可以持有这两个map的同一reference及显式ports，但不得创建mirror map、Room snapshot cache、second controller owner或second terminal registry。RoomRuntime、TerminalSlot与per-Room structure queue仍各只有一份。

## Room control coordinator

coordinator拥有：

* client id/control lease id生成与registration cleanup；
* connect/disconnect/pong/heartbeat sweep；
* personalized control view、acquire/takeover/release；
* controller expiry、lost/heartbeat hooks与control message broadcast；
* controlled client/bearer ticket admission、pre/post authorization wrappers与published-operation例外。

manager只做同名public delegate。连接消息顺序、epoch increment、TTL、lostControlEpoch、takeover await/lifecycle/context recheck、disconnect cleanup和hook swallowing完全不变。

## Terminal backend coordinator

coordinator拥有：

* terminal create/input/Text replacement/resize/reset/close；
* terminal/launch id collision guard、backend factory与Room-scoped env；
* candidate `start()`期间pending data/exit/error buffering和commit后的原顺序flush；
* current Room generation/Terminal object/launch guard；
* replay、terminal/Room revision、state/error/cwd/index message publish；
* cwd resolution、last-shell inheritance、debounce/cancel/refresh与backend close tracking。

manager继续拥有Room lifecycle、structure operation gateway、move/lock、destroy composition和public projection API；需要backend cleanup时通过coordinator显式方法委托。

## Frozen ordering

* connect：registered，再control，再snapshot。
* create：backend start成功与ticket active后commit，snapshot/index map，再flush pending callbacks。
* reset：candidate start；若成功，cancel old cwd、begin old close、commit new launch；旧backend同步flush仍由current-object guard过滤/按既有顺序观察；然后new snapshot/index map，再flush candidate pending data/exit/error。
* failed create/reset不改变Room current terminal；candidate backend仍进入close drain。
* output：append replay、advance revision、broadcast output、schedule cwd refresh。
* error：broadcast terminal_error、advance revision、broadcast terminal_state。
* destroy：control lost hook、destroy hooks、tickets drain、cwd cancel/backend close、closing promises drain、client notification/removal、Room removal。

## Tests

focused Gate必须覆盖：

* `roomControl033`全部controller/takeover/published/destroy race；
* `terminalRuntime032`全部replay/synchronous callback/reset/failure/env；
* `terminalRoomManager032`Room lifecycle/cwd/revision/identity；
* `terminalRoomDecomposition008`module boundary、single registry和pure coordinator dependency；
* content lease与Room runtime sync相关focused tests。

正式Gate为`just check`、`just build`、focused unit/integration、`just test-unit`、相关browser/Room E2E及`just diff-check`。public API drift、message/order drift、new cycle、duplicate implementation或warning阻断完成。
