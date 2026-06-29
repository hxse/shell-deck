# Contract

## 任务边界

本任务只交付 run log 和 artifacts 底座。完成后，shell-deck 能创建 run、append event、写 artifact、从 event log 重建 derived state，并在 UI 节点上展示同一份日志。它不负责真正执行宏步骤。

范围内：

* run event append API with per-run serial ordering。
* artifact write/read API with atomic write and path containment checks。
* derived state rebuild。
* config-scoped run isolation。
* node log view 数据模型。

范围外：

* 不执行 macro step。
* 不捕获 terminal-buffer 或 AgentEvent。
* 不调用 parser。
* 不实现 Codex adapter。

## 任务规范

### Storage layout

V0 run storage 必须 config scoped。`configId`、`runId`、`eventId`、`stepId` 和 artifact refs 必须遵守 root `Identifier Contract`，并在参与路径拼接前完成校验：

```text
.shell-deck/
  configs/
    <config-id>/
      runs/
        <run-id>/
          events.jsonl
          artifacts/
            send-0001.txt
            capture-0001.txt
            parser-input-0001.txt
            parser-output-0001.json
```

`events.jsonl` 是 run 的唯一真值。UI 节点日志和 AI 追溯日志都从同一份 event log 和 artifacts 派生，不能产生第二份状态真值。

节点日志 UI 默认折叠。用户展开某个节点时，必须能从同一份 event log/artifacts 看到该节点做过什么：resolved terminal、send_line 文本 artifact、input_line 用户输入 artifact、sleep duration、capture raw/normalized artifact、parser raw/normalized result、branch/control-flow 决策、pause/fail reason 和相关 artifact refs。AI 追溯读取的也是这同一份数据。

### Event envelope

每条 event 都必须包含 common fields。`stepId` 不是 common field，必须由 event kind 的 scope 决定。

```json
{
  "schemaVersion": 1,
  "eventId": "evt_...",
  "eventSeq": 1,
  "runId": "run_...",
  "configId": "local",
  "kind": "run_started",
  "createdAt": "2026-06-27T00:00:00.000Z",
  "summary": "short human readable summary",
  "data": {}
}
```

V0 event schema 必须按 scope 校验：

* run-scoped event：`run_started`、`run_completed`、`run_failed`、`run_interrupted` 必须省略 `stepId`。
* step-scoped event：`step_started`、`step_completed`、`step_failed`、`terminal_line_sent`、`user_input_requested`、`user_input_submitted`、`sleep_started`、`sleep_completed`、`parser_normalized`、`branch_decision`、`control_transition` 必须包含 `stepId`，且 `stepId` 必须遵守 root `Identifier Contract`。
* context-scoped event：`run_paused`、`run_resumed`、`artifact_created`、`user_override` 可以省略 `stepId` 表示 run-level；如果绑定到具体 step，则必须包含合法 `stepId`。
* replay 和 schema validation 必须按 kind/scope 判断 `stepId` 是否允许或必填，不能把 `stepId` 当作所有 event 的必填字段。

step-scoped 示例：

```json
{
  "schemaVersion": 1,
  "eventId": "evt_...",
  "eventSeq": 2,
  "runId": "run_...",
  "configId": "local",
  "stepId": "ask-review",
  "kind": "step_started",
  "createdAt": "2026-06-27T00:00:01.000Z",
  "summary": "started ask-review",
  "data": {}
}
```

大文本不能直接塞进 event，必须写 artifact 并在 event 中保存 ref。

### Append ordering and atomicity

Run event log 的顺序和写入语义必须冻结，后续 runner/recovery/UI/AI 追溯都只能依赖这份 contract。

* 每个 run 的 `events.jsonl` 内必须有单调递增的 `eventSeq`，从 `1` 开始，不允许 gap、重复或倒退。
* `eventId` 由 server 生成，同一 run 内唯一。replay 遇到重复 `eventId` 必须进入 recoverable error，不能去重后继续假装正常。
* 同一 run 内 append 必须串行化。V0 可以用 per-run mutex / queue / file lock；不能让两个 step 同时计算同一个 next `eventSeq`。
* append 顺序是唯一状态顺序。UI 展示和 derived state rebuild 都按 `eventSeq`，不是按文件 mtime 或 `createdAt` 排序。
* 大文本必须先写 artifact 到临时文件，fsync/flush 成功后 atomic rename 到最终 artifact ref；artifact 成功后才能 append 引用该 artifact 的 event。
* 如果 artifact 写入成功但 event append 失败，该 artifact 是 orphan artifact，recovery 可以列为 diagnostic，但不能把它当作已发生事件。
* 如果 event 已写入但 artifact 缺失，run 必须进入 recoverable error state，并在节点日志里标明缺失 artifact ref。
* 每条 JSONL event 必须以 `\n` 结束。replay 遇到文件尾半行、非法 JSON、schema mismatch、eventSeq gap/duplicate、eventId duplicate 时，必须停止 normal replay，进入 recoverable error state，保留已成功解析的 prefix 和错误位置。
* event append 必须要么完整写入一行，要么在 replay 时被识别为半行错误；不能把半行当作正常事件。
* `.004` 不实现多进程分布式写入；若后续要跨进程共享同一 run writer，必须先新增锁/事务任务。

### ArtifactRef

Artifact ref 是 server 生成的 run-local 相对引用，示例：

```json
{
  "artifactRef": "artifacts/send-0001.txt"
}
```

规则：

* artifact ref 只能指向当前 run 的 `artifacts/` 目录内文件。
* client、template、parser output 不能提交 arbitrary artifact path；只能引用 server 已返回的 ref。
* artifact ref normalize 后必须仍在 run artifacts root 内。
* artifact ref 不能包含 absolute path、`..`、反斜杠、空 segment 或 symlink escape。

### Event kinds

本任务至少定义并支持 append/replay：

* `run_started`
* `run_paused`
* `run_resumed`
* `run_completed`
* `run_failed`
* `run_interrupted`
* `step_started`
* `step_completed`
* `step_failed`
* `artifact_created`
* `terminal_line_sent`
* `user_input_requested`
* `user_input_submitted`
* `sleep_started`
* `sleep_completed`
* `parser_normalized`
* `branch_decision`
* `control_transition`
* `user_override`

后续任务可以扩展 event kind，但必须复用同一个 envelope。

### Derived state

刷新页面或重启 server 后，必须能从 `events.jsonl` 重建：

* run status
* current step id
* step latest status
* artifact index
* pause reason
* last error

如果 event log 损坏、eventSeq 出现 gap/duplicate、eventId 重复、文件尾半行或 artifact 缺失，run 必须进入 recoverable error state，并在节点日志里显示具体缺失项和可恢复 prefix。

## 示例

```text
1. eventSeq=1 run_started run=run_001 config=local template=review-fix-loop
2. eventSeq=2 step_started step=ask-review
3. write artifact artifacts/send-0001.txt atomically, then eventSeq=3 terminal_line_sent ref=artifacts/send-0001.txt terminalId=term_7k3p9d
4. eventSeq=4 step_completed step=ask-review
5. eventSeq=5 run_paused reason="waiting for user input"
6. eventSeq=6 user_override chooseNextStep=send-fix
7. eventSeq=7 run_resumed
```

## 测试

本任务验证 `events.jsonl + artifacts` 是唯一真值，节点日志和 AI 追溯不能分叉。

自动化测试至少覆盖：

* unit：event append sequence、eventSeq monotonicity、duplicate eventId rejection、gap/duplicate replay error。
* unit：event envelope union schema：run-level event 不要求 `stepId`，step-level event 必填 `stepId`。
* unit：event log replay and derived state rebuild。
* unit：artifact atomic write/read、orphan artifact diagnostic、missing artifact recoverable error、artifactRef containment。
* unit：config isolation for run ids and artifacts。
* unit：corrupt JSON line and trailing half-line enter recoverable error with parsed prefix retained。
* component/e2e：创建 run、写入模拟 events、刷新页面后节点日志和 derived state 一致。
* component/e2e：节点日志默认折叠，展开后能看到 send/input/sleep/capture/parser/branch/control-flow artifact refs。
* unit：event 已写入但 artifact 缺失时，replay error 必须携带 failed event metadata，node log 必须标明缺失 artifact ref。

可选人工 smoke 建议覆盖：

* 人工创建或导入模拟 run，展开节点日志。
* 检查每个节点能看出“做了什么、输入是什么、输出是什么、artifact 在哪”。
* 刷新页面或重启 server 后，确认 run 状态、节点日志和 artifact refs 能恢复。
* 人工确认 UI 节点日志和 AI 追溯日志来自同一份 event log/artifacts。

Gate 规则：

* `just check`、`just test-unit`、`just test-e2e`、`just test-004` 必须通过。
* 人工 smoke 是可选补充验证；如执行，结果写入 `04_review/**`，但未执行不阻断 Close Gate。
* event log replay/atomicity 有 P2 以上问题时不能进入 `.005`。
