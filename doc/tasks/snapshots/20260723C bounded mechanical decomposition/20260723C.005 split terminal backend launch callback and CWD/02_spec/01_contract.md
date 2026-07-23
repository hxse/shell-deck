# Formal Contract

## 任务边界

允许新增`terminalBackendLifecycle.ts`与`terminalCwdCoordinator.ts`或等价模块。`terminalBackendCoordinator.ts`继续导出`TerminalBackendCoordinator`、`CreateTerminalOptions`、`TerminalRuntimeContext`、`resolveShellCwd`和`defaultBackendFactory`，manager import不变。

## 任务规范

### Candidate launch与callback

* create/reset仍先验证Room/structure/options/size，再生成exact terminal/launch identity和backend。
* `backend.start()`期间的data/exit/error只进入candidate buffer；commit前不得broadcast或修改Room-owned terminal。
* start返回后必须先`ticket.assertActive()`并处理pending error，之后才能commit。
* create commit顺序保持commit store -> running -> terminal snapshot -> index map -> pending data/error/exit。
* reset顺序保持cancel old CWD -> begin old backend close -> commit restart -> running -> snapshot -> index -> pending callbacks。
* output/exit/error/CWD callback只处理current Room generation、terminal object和launch ID。
* failed candidate异步close并从Room pending close drain；不得泄漏backend或复活terminal。

### CWD lifecycle

* explicit cwd与cwdSource conflict、Text不支持cwd、last-shell inheritance和HOME fallback不变。
* resolved path继续要求absolute、existing real directory及原error。
* output触发的CWD refresh仍为60ms debounce；一个terminal最多一个timer。
* refresh只在current running Shell上读取并按publish flag发送`terminal_cwd`/revision。
* reset/close/Room destroy必须取消timer。

### Facade与state

* coordinator继续决定terminal structure mutation和message ordering。
* lifecycle modules不建立terminal map、replay或revision cache。
* close/input/Text/resize的返回值、error与ticket finish不变。

## 示例

正例：backend在`start()`内同步输出prompt并立即exit。create先commit terminal并发送initial snapshot/index，再按原序投影prompt和closed状态；不能在Room还没有terminal时广播output。

失败例：reset candidate启动后Room进入destroying。ticket active check失败，candidate被close，old terminal不被next runtime覆盖。

反例：CWD coordinator按terminalId缓存cwd而不校验launch，会让旧PTY的timer覆盖reset后的新launch。

## 测试

* `terminalRoomDecomposition008`、`terminalRuntime032`冻结candidate callback、revision、identity与lifecycle。
* `realPtyBackend`、`realRoomLifecycle`、`realPtyInteraction`冻结real backend/CWD/close。
* `terminalRoomManager032`与Room E2E冻结last-shell inheritance、reset、replay和message。
* 增加single runtime/no stale callback/module consumer boundary。
* 正式Gate：`just check`、build、focused unit/integration/Room E2E、`just diff-check`；本轮未执行。
