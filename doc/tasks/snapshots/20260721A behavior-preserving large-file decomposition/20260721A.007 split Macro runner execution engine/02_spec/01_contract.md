# Contract

## 任务边界

### Added Semantics

无。

### Frozen Semantics

* Start install、runId/binding snapshot、runtimeRevision和structure lock生命周期冻结。
* Flow node遍历、For index/key/value、If matcher/scope、Parallel lanes/merge与Finish语义冻结。
* Send delivery/ending、Wait、Input、Notify、Capture与Extract行为冻结。
* artifact visibility/value、template expansion和Unassigned defensive failure冻结。
* Pause/Resume/Stop/Destroy、input submit/cancel、cooperative yield和checkpoint时点冻结。
* durable event identity/sequence/order、bounded recent tail、summary/artifact与exactly-once terminalization冻结。
* runner snapshot/delta和notification publish冻结。
* AgentEvent默认unbounded、显式active-time timeout、Pause计时冻结、Stop、hook error与late-event baseline语义冻结。

### Primary file

`server/macroRunnerService.ts`。

## 任务规范

### 目标模块

* `server/macroFlowExecutor.ts`：顺序body、For、If/Elif/Else、Parallel、Finish递归；只操作显式execution context。
* `server/macroActionRuntime.ts`：Action dispatch和对terminal/notification/capture/extract adapters的调用。
* `server/macroTextEvaluation.ts`：MessagePart、step artifact和For template的pure evaluation。
* `server/macroAgentCapture.ts`：Room/terminal/launch-scoped AgentEvent query/capture，消费V5 exact `waitLimit`，不接受unbound event或hidden timeout。
* `server/macroRunnerService.ts`：active registry、lifecycle commands、checkpoint、input waiter、event commit、terminalization与publish。

### Execution context

executor收到不可变run snapshot、冻结terminal bindings、lexical artifact/For context和service提供的窄callbacks。它不得访问active run map、直接append evidence或自行发布snapshot。

callbacks至少区分：checkpoint、node/action lifecycle commit、wait for input、terminal send/read/quiet、notify、artifact publish和cooperative yield。实际接口可精简，但不得让executor成为第二个lifecycle owner。

### Cancellation与terminalization

* pending Input结果继续是submitted/cancelled分支，cancelled永不执行terminal send。
* 每个await/yield后复核run identity/abort/pause；destroyed/terminalized run不得继续写step/event。
* completed/failed/stopped只由service单一terminalization path提交一次。
* event line一旦authoritative commit，summary/prune maintenance失败不得让executor改写业务终态。

### Event与性能边界

* current cooperative yield budget、terminal quiet activity revision和bounded evidence tail保持不变。
* 拆分不恢复全量O(n²) snapshot读取，也不改变retention N。
* Action runtime不得缓存另一份terminal replay或Room state。

## 示例

### 合法

For forever的executor每到既有budget通过callback yield；service在yield后检测Stop并抛出内部cancel signal，唯一terminalization追加run_stopped并释放lock。

### 非法

* executorcatch所有异常后自行追加run_failed，而service又追加run_stopped。
* Input cancel用空字符串模拟submitted。
* Action module直接从Room manager按index重新解析terminal，绕过冻结binding。
* 为方便抽取改变step_started/step_completed顺序。

## 测试

### Unit

* pure template/artifact/For evaluation完整等价。
* Flow traversal覆盖nested For/If/Parallel/Finish、continue/stop和artifact scope。
* executor callback trace与拆分前exact node/action ordering一致。

### Integration/fault injection

* tight forever下timer与Stop deadline、pause/resume、Destroy/input cancellation。
* terminal quiet满tail、Send ending/delivery、multi-terminal capture。
* event append在write/fsync/summary/prune故障下的幂等、single terminal event和structure unlock。
* bounded tail、delta snapshot、notification与AgentEvent Room scope、unbounded/timeout/Pause/Stop/hook-error/late-event baseline。

### Gate

运行runner/store unit、macro runtime integration、`.034/.035/.037/.038` E2E、offline complex Macro dogfood、`just check`、build与`git diff --check`。
