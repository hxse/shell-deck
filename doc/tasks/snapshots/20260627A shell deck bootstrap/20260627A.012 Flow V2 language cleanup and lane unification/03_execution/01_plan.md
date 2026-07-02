# Execution Plan

## Phase 1: Contract Freeze

目标：冻结 Flow V2 语言清理边界和并发原语边界。

工作项：

* 明确 Flow V2 主语言禁止旧控制字段，且递归禁止嵌套旧字段。
* 明确 v1 只作为 legacy compatibility layer。
* 明确 `parallel_all` 不再是 lane-local workflow 子语言。
* 明确 `parallel_all` lane 只支持 send/wait/capture。
* 明确并发结果通过 `merge_parallel_results` 机械合并，再由 `parse` / `send_artifact` 使用。

停止线：

* 如果 Flow V2 允许保存 `next/goto/branch/loopGuard`，不能进入 compiler/interpreter 实现。
* 如果 `parallel_all` lane 长期继续使用 v1 `steps`，不能进入 compiler/interpreter 实现。
* 如果 `parallel_all` lane 被设计成完整 Flow V2 子语言，必须重新评估并发用户交互、lane-local input、pause/resume 与日志语义；V0 不走这条路。

## Phase 2: Schema Update Task

目标：本任务实现一个 validator / type slice，冻结新 schema 方向。

文件边界：

* `src/lib/macro/flowV2Types.ts`
* `src/lib/macro/flowV2Schema.ts`
* `tests/unit/flowV2Schema.test.ts`

验证重点：

* Flow V2 action/control nodes 拒绝 unknown keys。
* Flow V2 validator 递归拒绝 `steps/next/loopGuard/goto/branch/complete/pause/stop/fail`。
* `parse` 使用显式 artifact source，不再使用 `captureStep`。
* `capture-source` 产出 `captured_text`。
* `parallel_all.lanes[*]` 使用受限 send/wait/capture schema，拒绝 v1 lane `steps`、`success`、Flow V2 `body`。
* lane wait 只允许 `duration` 和 `terminal-quiet`。
* lane 不允许 `input_line` / `user-continue` / parse / nested control flow。
* 同一个 `parallel_all` 内 lane terminal 不重复；没有 `indexMap` 时同 kind/value 也必须可检测。
* `merge_parallel_results` 必须引用 `visible predecessor scope` 中的前序 `parallel_all`。
* `send_artifact` 和 `parse` 必须引用 `visible predecessor scope` 中的前序 artifact-producing step。

## Phase 3: Compiler / Interpreter Preparation

目标：让后续 compiler/interpreter 只面对单一 AST。

设计要求：

* 编译器输入：`FlowV2Template.body`。
* `parallel_all` 编译为受限 fan-out/fan-in action，不递归解释 lane body。
* `merge_parallel_results` 编译为 artifact-producing action。
* v1 template 不进入 Flow V2 compiler。
* legacy runner 或 legacy adapter 单独处理 v1。
* run log 事件需要包含 block path 和 lane id，例如：
  * `parallel_review/lane_docs/send`
  * `parallel_review/lane_docs/wait`
  * `parallel_review/lane_docs/capture`
  * `merge_review_outputs`

## Phase 4: GUI Follow-up

目标：避免后续侧边面板 UI 建在旧语言上。

工作项：

* Flow palette 只显示 V2 控制节点。
* Legacy flow nodes 继续折叠显示。
* `parallel_all` lane 编辑器后续只编辑 lane send/wait/capture，不编辑 v1 `steps`，也不编辑完整 Flow V2 body。
* 增加 `merge_parallel_results` 与 `send_artifact` 的表单入口。
* `.013 workspace side panels and prompt library` 做 UI 布局时，应以本任务语言边界为准。

## Close Gate

本任务已落地 schema implementation slice：

* `parallel_all.lanes[*]` 从 v1 `steps` / Flow V2 lane body 收窄为 send/wait/capture。
* 新增 `merge_parallel_results` 与 `send_artifact` schema。
* Flow V2 validator 递归拒绝旧控制字段。
* Flow V2 validator 校验显式 artifact source 与同 block 前序引用。
* Flow V2 validator 在没有 `indexMap` 时也能发现同 kind/value lane terminal 重复。
* 新增 `just test-012` targeted gate。

当前 close gate：

```bash
bun test tests/unit/flowV2Schema.test.ts
just check
just test-012
just test-unit
just test-e2e
git diff --check
```

仍未进入本任务实现范围：

* Flow V2 compiler/interpreter。
* v1 template migration。
* 完整 block-tree GUI。
* `merge_parallel_results` / `send_artifact` 的 runner 执行实现。
