# Problem Context

## Current evidence

`src/lib/macro/macroRecordSession.svelte.ts`为926行，约22个mutable state和40个嵌套函数。list/navigation与selection位于前段，CRUD/lease位于198–466行，visual/JSON persistence与Start record resolution位于495–666行，remote reconciliation位于668–792行，state commit与operation identity位于794行以后。

## 为什么不做generic session

Macro有visual/JSON双revision、runnable validation、Start前persist、Save to Library和published first-Create buffer preservation；Library有kind/search/navigation/load语义。二者只共享content lease primitive，不共享完整state machine。用feature flag统一会隐藏不同commit guard，因此本task只抽Macro-specific workflow/coordinator，下一task另做Library-specific实现。

## State owner

factory内的`templates`、`selectedRecord`、`baseDefinition`、`draft`、revision、editing/lease、dirty/preservation、operation、error/label仍是唯一rune truth。MutationWorkflow不得保存这些值；每次调用使用显式snapshot/live guard。RemoteSyncCoordinator可拥有queue watermark、serialized promise、read generation、retry timer等纯协调状态，但不得缓存record/draft/lease或直接声明`$state`。

## 主要风险

* controller/operation/draft/JSON revision变化后stale response仍安装。
* first Create已publish但lease acquisition或operation context变化，fresh identity/buffer未保留。
* update lease retained/lost outcome与record install顺序改变。
* own ack、higher revision、delete混合batch被错误消费。
* reconnect/focus重读覆盖dirty/editing/lease-lost/JSON/preserved buffer。
* retry timer或serialized drain在dispose后残留。
