# Execution Plan

## 模块边界

本任务只实现 run log 和 artifact 底座，不执行 macro step。建议模块边界：

```text
src/lib/runLog/runEventTypes.ts
src/lib/runLog/runEventSchema.ts
src/lib/runLog/runEventWriter.ts
src/lib/runLog/runEventReplay.ts
src/lib/runLog/runDerivedState.ts
src/lib/runLog/artifactStore.ts
src/lib/runLog/identifier.ts
src/lib/components/RunLogView.svelte
src/lib/components/RunNodeLog.svelte
tests/unit/identifier.test.ts
tests/unit/runEventWriter.test.ts
tests/unit/runEventReplay.test.ts
tests/unit/artifactStore.test.ts
tests/unit/runDerivedState.test.ts
tests/e2e/runLogView.spec.ts
```

`identifier.ts` 应实现 root `Identifier Contract`，供 `.002/.003/.004` 复用或作为后续迁移目标。

## 阶段

1. 定义 `RunId/EventId/EventSeq/ArtifactRef` 类型、common event envelope、run-scoped/step-scoped event union schema 和 identifier validation。
2. 实现 config/run storage path resolver：所有 path join 前先校验 id，normalize 后确认仍在 `.shell-deck/configs/<configId>/runs/<runId>/` 内。
3. 实现 artifact writer：先写 temp file，flush/close 成功后 atomic rename；返回 server-generated run-local `artifactRef`。
4. 实现 per-run serial event writer：持有 per-run mutex/queue，计算 next `eventSeq`，完整追加一行 JSONL，保证 `\n` 结尾。
5. 实现 replay：按文件顺序解析，校验 schema、eventSeq monotonic、eventId unique、artifact refs existence；错误时返回 recoverable error 和 parsed prefix。
6. 实现 derived state rebuild：run status、current step、step status、artifact index、pause reason、last error。
7. 实现 node log view data model 和最小 UI：同一 event log 派生人类可展开日志和 AI 可读 artifact refs。
8. 补 unit/e2e，覆盖 run-level event 不要求 `stepId`、step-level event 必填 `stepId`、半行、重复、gap、artifact 缺失、orphan artifact、config isolation。

## 验证命令

```bash
just check
just test-unit
just test-e2e
just test-004
```

## Legacy Kill List

本任务不得引入：

* macro step executor。
* terminal-buffer 或 AgentEvent capture。
* parser / Spark / Codex exec。
* 第二份 UI 状态真值。
* 任意未验证 id 或 artifact path 进入 filesystem。

## 阶段停止线

进入 `.005` 前必须满足：

* 同一 run 内 eventSeq 从 1 开始单调递增，重复/gap 会使 replay 进入 recoverable error。
* 大文本先写 artifact，成功后写 event；event 引用不存在 artifact 时 replay 报 recoverable error。
* append 是 per-run 串行，不会并发生成相同 eventSeq。
* UI 节点日志和 AI 追溯读取同一份 event log/artifacts。
* config A 的 run/artifacts 不能通过 id/path 访问 config B。

## Close Gate

* `just check`、`just test-unit`、`just test-e2e`、`just test-004` 通过。
* event log replay and derived state rebuild 通过 corrupted/gap/duplicate/half-line cases。
* artifact 引用可追溯，缺失时有明确 recoverable error。
* 页面刷新后节点日志和 derived state 与同一份 events.jsonl 一致。
* 人工 smoke 覆盖节点日志默认折叠、展开追溯 send/input/sleep/capture/parser/branch artifacts、刷新恢复；这是可选补充，不阻断 Close Gate。
* `git diff --check` 通过。
