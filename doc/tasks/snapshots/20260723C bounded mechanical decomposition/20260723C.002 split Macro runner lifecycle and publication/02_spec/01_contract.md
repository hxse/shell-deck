# Formal Contract

## 任务边界

允许新增Macro live-run lifecycle、interaction和publication internal模块；`macroRunnerService.ts`继续导出`MacroRunnerService`、`MacroNotRunnableError`与`MacroStartPreflight`，现有route/manager consumer不改import。

## 任务规范

### 单一live truth

* 每个Room最多一个current `LiveRun` object；registry、abort controller、pending input、pause waiters、artifacts和parallel progress不得复制。
* coordinator可持有对同一object的引用或通过getter取得它，不得建立序列化mirror。
* idle/runtime revision也只有一个owner，Room destroy后按原语义清理。

### Live-run lifecycle

* Start顺序保持：input/revision检查 -> active/structure检查 -> reread record与hash -> binding -> reserve id -> acquire structure lock -> authorization -> publish manifest -> authorization -> append`run_started` -> authorization -> install live run -> publish -> queue execute。
* Start失败只按现有published阶段写`run_failed`或remove unstarted evidence，并精确释放structure lock。
* execute继续使用冻结definition/bindings；finish最多一次，先append terminal event，再terminalize/update/publish，finally释放lock。
* Room destroy取消abort/pause/input，terminalize后清registry/timer/revision，不能复活run。

### Pause与runtime input

* Pause/Resume status guard、event kind、paused-duration计算、waiter唤醒和cooperative yield顺序不变。
* Input request继续生成fresh invocation ID、从revision 0开始，并在event append成功后暴露waiting state。
* draft update只接受matching invocation/revision并递增一次。
* submit必须先append`runner_input_submitted`；append失败时pending input、status和revision保持可重试。
* Stop/Destroy必须resolve pending input为cancelled，不能留下await。

### Snapshot publication

* snapshot wire shape、event window与idle shape不变。
* 每次business state变更按原规则递增Room-local runtime revision。
* 25ms timer每个run最多一个；timer不保持process存活。
* generation/current-run不匹配时不发布。
* `publishedEventSeq < firstAvailableEventSeq - 1`时发full snapshot，否则只发未发布event delta；发送后更新watermark。

## 示例

正例：Input submit的evidence append抛错。API继续报`run_event_append_failed`，原pending input仍在，用户可用同一expected revision重试；不能先清pending再发现append失败。

正例：event retention让consumer watermark落在窗口之前。下一次publication必须发`runner_snapshot`修复，而不是缺首段的delta。

反例：interaction coordinator保存自己的`pendingInput`副本，或publication根据创建时snapshot发布，均构成第二份truth。

## 测试

* `macroRunnerExecution007.test.ts`冻结single registry、cancel、checkpoint与artifact callback。
* `macroRuntime034.*`冻结Start/manifest/event/lock、Pause/Input、terminal quiet、durability与AgentEvent timing。
* `runnerSnapshotMerge035.test.ts`及Room runtime E2E冻结snapshot/delta、gap repair、takeover和input coalescing。
* 新增module boundary/no-duplicate-state/source owner断言。
* 正式Gate：`just check`、build、focused unit/integration/E2E、`just diff-check`；本轮未执行。
