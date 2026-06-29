# Execution Plan

## 模块边界

本任务实现受限 `parallel_all`，不改动 capture/parser 的通用语义。建议模块边界：

```text
src/lib/macro/parallelAllTypes.ts
src/lib/macro/parallelAllValidator.ts
src/lib/macro/parallelAllRunner.ts
src/lib/macro/laneStateRebuilder.ts
src/lib/macro/laneSuccessCondition.ts
src/lib/macro/runPreflight.ts
src/lib/events/parallelAllEvents.ts
src/lib/ui/ParallelAllEditor.svelte
src/lib/ui/ParallelAllNodeLog.svelte
tests/unit/parallelAllValidator.test.ts
tests/unit/parallelAllRunner.test.ts
tests/integration/parallelAllTerminalBufferRegex.test.ts
tests/integration/parallelAllAiJsonMock.test.ts
tests/e2e/parallelAll.spec.ts
```

`parallel_all` 必须复用已有 terminal ref resolver、capture source adapter、parser adapter、artifact writer 和 RunEventLog append API。不要复制一套 parallel 专用 capture/parser。

## 阶段

1. 定义 `ParallelAllStep`、`Lane`、`LaneSuccessCondition` 类型和 schema validation。
2. 扩展 template workbench UI：新增 `parallel_all` step、lane CRUD、lane terminal 选择、JSON preview/import/export；lane 内 steps 和 success conditions 通过 JSON 配置，完整嵌套编辑器后置。
3. 扩展 runner preflight：lane terminal resolution、duplicate terminal fail、capture source terminal match、非法 lane step fail、success condition declared signal validation。
4. 实现 lane state rebuild：从 eventSeq 重建 lane pending/running/waiting/succeeded/failed；server crash 后的 lane 级 unknown recovery 后置。
5. 实现 `parallelAllRunner`：并发启动 lane，复用 `send_line`、`sleep`、`wait`、`capture-source`、`parse` 执行器。
6. 实现 all-success join、condition fail pause/fail、timeout pause/fail、stop 整体 run。
7. 实现 resume idempotency：正常 pause/resume 下已发送 lane 不重复发送，已成功 lane 不重跑；send 已到 terminal 但 event 未落盘的 crash 窗口后续单独设计。
8. 实现 UI 节点日志：父节点默认折叠，展开可看每个 lane 的输入、等待、capture、parser、condition、artifact。
9. 补 offline tests 和 e2e：terminal-buffer + regex、terminal-buffer + mock ai-json、AgentEvent + mock parser。
10. 写 review/verification，记录 online Codex hook smoke 是否执行。

## 验证命令

```bash
just check
just test-unit
just test-e2e
just test-008-offline
just test-008-online
```

`test-008-offline` 只允许 fake terminal、terminal-buffer fixture、mock AgentEvent 和 mock ai-json。`test-008-online` 才允许真实 Codex hook / online model，默认 `just test` 不应隐式调用。

## Legacy Kill List

本任务不得引入：

* 同 config 多个 live macro run。
* terminal-level lock scheduler。
* lane 共享自动发送 terminal。
* lane 内 `input_line` 或控制流。
* nested `parallel_all`。
* parallel 专用 parser/capture 旁路。
* condition 字符串表达式或 JS eval。
* 未写 event log 的后台等待。

## 阶段停止线

进入 `.009` 前必须满足：

* `parallel_all` 只作为单个 run 内 step 存在，同 config 单 live run 约束不变。
* lane capture/parser 完全复用 `.006`/`.007` 通用 adapter。
* duplicate terminal 和非法 lane step 在 preflight 阶段失败。
* all-success join、失败 pause/fail、正常 pause/resume 去重都有自动化测试。
* UI 节点日志和 AI 追溯日志来自同一份 event log。
* `.008` UI 接受 JSON-only lane internals：lane id/terminal 可视化编辑，lane steps/success conditions 通过 JSON preview/import/export 配置。
* offline e2e 覆盖 terminal-buffer+regex、terminal-buffer+mock ai-json、AgentEvent+mock parser。

## Close Gate

* `just check`、`just test-unit`、`just test-e2e`、`just test-008-offline` 通过。
* `just test-008-online` 在具备 Codex/OpenAI auth/network 时通过；不可用时记录 blocked reason。
* 人工 smoke 不阻塞 `.008`，延后到 V0 closeout；本任务只记录是否已执行、未执行原因和建议覆盖项。
* review/verification 文档写入 `04_review/**`。
* `git diff --check` 通过。
