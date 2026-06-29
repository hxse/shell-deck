# Execution Plan

## 模块边界

本任务实现 runner 状态机，但只接 mock capture/parser。建议模块边界：

```text
src/lib/macro/runnerTypes.ts
src/lib/macro/runnerState.ts
src/lib/macro/runnerEngine.ts
src/lib/macro/terminalRefResolver.ts
src/lib/macro/mockCaptureSource.ts
src/lib/macro/mockParser.ts
src/lib/macro/runnerPreflight.ts
src/lib/components/MacroRunView.svelte
src/lib/components/MacroRunNodeLog.svelte
tests/unit/macroRunnerState.test.ts
tests/unit/terminalRefResolver.test.ts
tests/unit/macroRunnerPreflight.test.ts
tests/integration/macroRunnerFakeTerminal.test.ts
tests/e2e/macroRunnerState.spec.ts
```

依赖边界：

* 读取 `.003` 的 macro template schema 和 `ProfileCatalogSummary` stub。
* 写入 `.004` 的 run event log 和 artifacts。
* 调用 `.002` 的 terminal deck API。
* 不读取真实 terminal-buffer，不读取 AgentEvent，不调用真实 parser。

## 阶段

1. 定义 runner lifecycle、step execution context、step result、pause/fail reason 类型。
2. 实现 `TerminalRefResolver`：index/id/alias -> terminalId，强制 config isolation。
3. 实现 runner preflight：template schema、profile summary、branch signal、capture source、terminal ref、step id graph。
4. 实现 `send_line`、`wait`、`sleep`、`input_line`、`capture-source`、`parse` stub、`branch`、`goto`、带 `loopGuard.maxIterations` 的简单回跳循环、`pause`、`complete`、`fail`、`resume`、`stop` 的 pure state reducer。
5. 接入 `.004` event writer：每个动作写 event，大文本写 artifact。
6. 实现 mock capture source 和 mock parser result 注入，覆盖成功、不确定、非法 signal、missing source。
7. 实现最小 run UI：开始、暂停、恢复、停止、同 config live run 冲突提示、切换 config、当前 step、input_line 输入框、节点日志展开、artifact refs。
8. 补 unit/integration/e2e，并写 known limitations：真实 capture 和 parser 留给 `.006/.007`。

## 验证命令

```bash
just check
just test-unit
just test-e2e
just test-005
```

## Legacy Kill List

本任务不得引入：

* 后台 role loop 或 Codex-specific runner。
* 自动越过 `null` / unknown / parser disagreement。
* 直接写 UI 状态而不写 run event log。
* 真实 Spark / Codex exec 调用。
* 把 Codex session 写进 macro template。

## 阶段停止线

进入 `.006` 前必须满足：

* runner 在 mock capture/parser 下可以完成 send_line -> sleep -> wait -> capture-source -> parse -> branch -> input_line/pause/resume 的闭环，覆盖带 `loopGuard.maxIterations` 的 branch/goto 简单循环，并拒绝同 config 第二个 live run。
* 页面刷新后 run state 从 `.004` event log 重建，不依赖内存状态。
* structured branch condition 引用 selected parse output 外的 signal/op、value 不匹配 signal type、保存字符串表达式，或尝试字符串宽松比较，会 preflight fail 或 pause。
* terminal reorder 后 index ref 使用当前 mapping，id ref 始终指向同一 terminal。
* 所有 pause/fail 都有用户可读 reason 和 event log 证据。

## Close Gate

* `just check`、`just test-unit`、`just test-e2e`、`just test-005` 通过。
* runner 能执行最小模板闭环。
* 所有步骤可追溯，刷新后可恢复。
* 不确定或不合法状态必须 pause/fail，不自动越过用户。
* 可选人工 smoke 建议覆盖 `send_line -> sleep -> input_line -> branch`、带 `loopGuard` 的回跳循环、暂停、同 config 第二个 run 被拒绝、切换另一 config 启动宏、恢复和节点日志展开；若执行则写入 `04_review/**`，未执行不阻断 Close Gate。
* `git diff --check` 通过。
