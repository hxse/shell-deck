# Server Consistency Guard Contract

## 任务边界

本任务只修复 Trace freshness、Room generation registration、content edit lease rollback、Trace index lock path 和 file-size early signal。现有 HTTP/WS payload、Macro schema、controller takeover规则、lease TTL/epoch、Trace retention/cursor、400 行 hard limit和用户UI保持不变。

浏览器安全证明、resource envelope、retention policy、evidence/AgentEvent写入批处理及现有near-limit文件拆分不进入本任务。做到五项guard均有正反例、相关current docs一致、focused与完整Gate通过即停止。

## 任务规范

### Trace direct-event freshness

`EvidenceStore.page(runId, afterEventSeq, limit)`与`traceSummary(runId)`共享同一个per-process、per-run freshness marker。

* marker缺失时，读取并验证首尾retained segment；合法但stale的`summary.json`必须在返回page前修复。
* 成功验证或成功修复后安装marker；同进程普通append立即使marker失效。
* marker存在时，event page除summary文件外只读覆盖请求范围的segment，不枚举全部segment。
* cursor大于修复后authoritative `lastEventSeq`仍返回`invalid_trace_event_cursor`。

首次cold direct event request允许为freshness recovery额外枚举segment并读取首尾；这不是warm page的常态I/O。

### Generation-bound WebSocket registration

WebSocket upgrade冻结`roomId + roomGeneration`。open阶段必须把该expected generation传入`TerminalRoomManager`的唯一client-registration链路。

registration是一个不跨`await`的同步临界区：

1. 读取active Room并在任何client ID分配、registry写入、message或controller mutation前比较expected generation；
2. mismatch直接抛出`room_generation_conflict`，不得注册client、广播、取得controller或改变control epoch；
3. registration后续任一步失败时，删除本次client的Room/global registry entry，并精确撤销只由本次fresh-first-client registration产生的controller transition；
4. 回滚不得覆盖其间已经出现的不同controller identity；回滚后下一个有效fresh client仍能按原规则成为controller。

未提供expected generation的内部测试/程序化调用继续连接调用时的current generation；canonical Room WebSocket必须提供。

### Post-publish content lease rollback

Acquire与takeover的record transaction成功publish held lease后，必须再次执行既有controller authorization。若该post-publish检查失败：

* 在返回原authorization error前，同步等待同一record transaction完成rollback；
* rollback只在current held state的全部持久化字段都与刚发布state相同时，把它改为同epoch的available state；
* current state已被其他owner/epoch替换时必须no-op，不得删除新真值；
* 成功释放时通过既有`onChanged`发布available view；
* 失败请求不得把lease加入process-owned map，也不得返回grant。

正常acquire/takeover、TTL、renew、release、commit及record revision语义不变。

### Canonical lock path

Trace derived index唯一cross-process lock为：

```text
<User Data Root>/.locks/trace-index.lock
```

实现必须从canonical User Data Root path定义取得locks directory，不得再创建或读取`<User Data Root>/locks/`。

### File-size soft advisory

Project-authored source达到350行且不超过400行时进入non-blocking advisory集合；超过400行仍进入blocking issue集合。

CLI打印每个near-limit文件的path、actual lines、350 soft limit与400 hard limit，并在summary记录advisory数量。Advisory退出码仍为0；invalid source或401行继续退出1。该advisory是file-size policy的提前信号，不冒充TypeScript/Svelte/build warning，也不提供path exception。

## 示例

Stale summary记录`lastEventSeq=1`，segment已有seq 2：

```text
GET .../traces/<runId>/events
=> 首次cold读取先把summary修到2，再返回seq 1..2
=> 后续同进程page只读请求range所在segment
```

旧socket在generation A完成upgrade，open前同Room token已变成generation B：

```text
connect(roomId, expected=A)
=> room_generation_conflict
=> generation B: clients=0, controller=null, controlEpoch不变
```

Acquire刚publish lease 7后controller被takeover：

```text
post authorization => room_control_lost
current lease仍是刚发布identity => rollback为available(epoch=7)
current lease已经是其他identity => 保留current state
```

File-size边界：

```text
349 lines => no advisory
350 lines => advisory, exit 0
400 lines => advisory, exit 0
401 lines => violation, exit 1
```

## 测试

Focused tests必须证明：

1. cold direct event page修复普通non-checkpoint event造成的stale summary，warm page恢复range-only segment I/O；
2. stale WebSocket generation在任何registration副作用前失败，registration中途失败不会留下ghost client/controller或消耗fresh control epoch；
3. acquire与takeover的post-publish authorization failure释放exact newly-published lease，且不加入owned map；
4. Trace index只在`.locks/trace-index.lock`建立lock；
5. 349/350/400/401行分别符合advisory/hard issue边界，scanner仍覆盖全部project-authored code且无exception；
6. `just test-20260725b`、`just check`、`just build`、完整unit/integration/E2E与`just diff-check`按顺序通过；除明确的file-size advisory外不得出现warning/error。
