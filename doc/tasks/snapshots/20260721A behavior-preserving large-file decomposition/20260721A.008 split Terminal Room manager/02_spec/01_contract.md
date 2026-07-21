# Contract

## 任务边界

### Added Semantics

无。

### Frozen Semantics

* Room create/lazy-create/list/destroy/generation/capacity和server restart边界冻结。
* terminal create/insert/delete/reorder/restart、continuous UI index、stable runtime id/type/launch冻结。
* Shell PTY input/output、Text full-state revision/ack、multi-client ordering和last-shell-cwd创建行为冻结。
* replay byte cap、chunk/order、output activity revision、terminal quiet观察和terminal response filtering冻结。
* roomRevision/terminal revision/readiness、snapshot/delta和stale merge contract冻结。
* controller admission、terminal structure lock、Prepare mutation与Destroy lifecycle barrier冻结。
* broadcast、cleanup、PTY kill与resource ownership冻结。

### Primary file

`server/terminalRoomManager.ts`。

## 任务规范

### 目标模块

* `server/terminalReplayBuffer.ts`：bounded byte/chunk tail、append、projection与单调output activity；无Room知识。
* `server/terminalRuntimeState.ts`：Shell/Text discriminated runtime、id/type/launch/readiness/text revision和resource handle。
* `server/terminalSnapshotProjection.ts`：从authoritative Room/runtime生成wire snapshots/deltas，不修改state。
* `server/roomLifecycleCoordinator.ts`：active/destroying/destroyed admission、generation ticket、in-flight drain与resource cleanup。
* `server/terminalMutationCoordinator.ts`：在manager queue内执行create/insert/delete/reorder/restart/lock-aware mutation。
* `server/terminalRoomManager.ts`：Room registry、per-Room serialized queue、public facade、broadcast wiring与coordinator composition。

### Ownership与依赖

* manager中的Room record是唯一authoritative live state；coordinator不保存shadow Room map。
* lifecycle与mutation共享同一个per-Room queue/admission，不得各建mutex导致ordering分叉。
* replay/runtime对象由Room record拥有，projection只读，不自行递增revision。
* PTY callbacks必须以room generation + terminal id + launch id复核，旧launch输出不得进入新runtime。
* runner和HTTP继续只依赖manager public facade，不直接import内部coordinator。

### Revision规则

拆分不得合并或重定义revision。room structure/lock、terminal state/readiness/replay/text mutation各自何时推进，必须与current实现及active spec完全一致。snapshot projection不通过“渲染次数”制造新revision。

## 示例

### 合法

PTY output callback调用manager facade；manager复核Room generation和launch，向runtime replay append并推进既有activity/state revision，再由projection产生完全相同的snapshot/event。

### 非法

* replay模块自行广播WebSocket。
* lifecycle coordinator和mutation coordinator各自持有Room副本。
* projection为方便比较修改readiness或revision。
* runner绕过manager按数组index直接持有可变terminal对象。

## 测试

### Unit

* replay cap/chunk/UTF-8与activity revision。
* Shell/Text runtime exact projection、text revision与stale ack。
* lifecycle active→destroying→destroyed及generation ticket。
* mutation index/id/type/launch/revision与lock matrix。

### Integration/E2E

* real PTY create/input/output/restart/delete/destroy与旧launch隔离。
* multi-client terminal sync、Text delayed echo、stale snapshot/delta和structure lock race。
* new shell继承最后一个live shell cwd；无shell使用`~`；既有标题/metadata单行显示不变。
* TUI进入/退出、tab切换与terminal response filter回归。
* Prepare/runner冻结binding期间禁止structure mutation，terminal quiet按activity而非tail length。

### Gate

运行Terminal Room unit/integration、real PTY、Room双标签、Prepare/runner E2E、TUI regression、`just check`、build与`git diff --check`。
