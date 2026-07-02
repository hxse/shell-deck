# Contract

## Scope

范围内：

* 冻结 Flow V2 语言清理边界。
* 把 `parallel_all` 收窄为受限 fan-out / fan-in 原语。
* 新增 `merge_parallel_results` 与 `send_artifact` 的 Flow V2 schema 方向。
* 明确 v1 语法只能存在于 legacy template compatibility layer。
* 明确新模板主路径禁止旧控制字段，包括嵌套对象里的隐藏字段。
* 为后续 Flow V2 compiler/interpreter 提供单一、可验证的 AST 输入。

范围外：

* 不实现 compiler/interpreter。
* 不改现有 v1 runner。
* 不迁移已有用户模板。
* 不删除 v1 import/read/execute compatibility。
* 不实现完整 block-tree GUI。

## Language Boundary

Flow V2 主语言只允许：

Actions:

* `send_line`
* `send_artifact`
* `input_line`
* `sleep`
* `wait`
* `capture-source`
* `parse`
* `parallel_all`
* `merge_parallel_results`

Flow controls:

* `if`
* `elif` branch kind
* `else` branch body
* `for`
* `break`
* `continue`
* `return`

Flow V2 主语言禁止保存：

* `steps`
* `next`
* `loopGuard`
* `goto`
* `branch`
* `complete`
* `pause`
* `stop`
* `fail`
* string condition / expression DSL，如 `"x == true"`

这些旧字段只能出现在 `schemaVersion: 1` legacy template 中。Flow V2 validator 必须递归拒绝隐藏在 `range`、`join`、`capture`、`parser`、`rules[]` 等嵌套对象里的旧控制字段。

## Parallel All Contract

`parallel_all` 不是 lane-local workflow 语言。它只负责：

1. 向多个不同 terminal 并发发送文本。
2. 等待所有 terminal 完成。
3. 抓取每个 terminal 的输出。
4. 产出每个 lane 的 capture artifact refs。

lane 内只允许：

* `id`
* `terminal`
* `send.text`
* `wait`
  * `duration`
  * `terminal-quiet`
* `capture`
  * V0 只支持 `terminal-buffer` / `scrollback-tail`

`parallel_all.join` 只允许：

* `mode = all_completed`
* `onLaneFail`
* `onTimeout`

lane 内禁止：

* `input_line`
* `parse`
* `if/elif/else`
* `for/break/continue/return`
* `sleep mode=until-resume`
* nested `parallel_all`
* v1 `steps` / `success`
* lane 内额外 terminal action

目标 schema：

```json
{
  "id": "parallel_review",
  "type": "parallel_all",
  "lanes": [
    {
      "id": "docs",
      "terminal": { "kind": "alias", "value": "docs_reviewer" },
      "send": { "text": "review docs only" },
      "wait": {
        "mode": "terminal-quiet",
        "quietMs": 1000,
        "maxMs": 120000,
        "onTimeout": "pause"
      },
      "capture": {
        "kind": "terminal-buffer",
        "mode": "scrollback-tail",
        "maxChars": 12000
      }
    },
    {
      "id": "tests",
      "terminal": { "kind": "alias", "value": "tests_reviewer" },
      "send": { "text": "review tests only" },
      "wait": {
        "mode": "duration",
        "durationMs": 1500
      },
      "capture": {
        "kind": "terminal-buffer",
        "mode": "scrollback-tail",
        "maxChars": 12000
      }
    }
  ],
  "join": {
    "mode": "all_completed",
    "onLaneFail": "pause",
    "onTimeout": "pause"
  }
}
```

终端约束：

* 每个 lane 必须声明一个 primary terminal。
* 同一个 `parallel_all` 内不允许多个 lane 指向同一个 terminal。
* 有 `indexMap` 时，`index` / `alias` / `id` 解析后比较。
* 没有 `indexMap` 时，同 kind/value 可直接比较；无法证明相等时不自动视为相等，但不能因缺少 `indexMap` 接受同 kind/value 重复。

## Merge Parallel Results

并发结束后不在 lane 内解析。需要先用 `merge_parallel_results` 机械合并结果。

```json
{
  "id": "merge_review_outputs",
  "type": "merge_parallel_results",
  "source": {
    "kind": "parallel_all",
    "stepId": "parallel_review",
    "captures": "all"
  },
  "format": {
    "kind": "sectioned_text",
    "includeLaneId": true,
    "includeTerminal": true
  }
}
```

`merge_parallel_results` 只做机械拼接，不调用模型，不做语义判断。输出 artifact：

* `merged_text`

推荐文本格式：

```text
===== lane: docs | terminal: docs_reviewer =====
...

===== lane: tests | terminal: tests_reviewer =====
...
```

## Artifact Source Contract

`parse` 和 `send_artifact` 不靠“最近一个结果”猜测来源，必须显式声明 source。

解析合并结果：

```json
{
  "id": "parse_merged_review",
  "type": "parse",
  "source": {
    "kind": "step_artifact",
    "stepId": "merge_review_outputs",
    "artifact": "merged_text"
  },
  "parser": {
    "kind": "ai-json",
    "profileId": "review-routing-v1"
  }
}
```

发送合并结果：

```json
{
  "id": "send_review_summary_to_worker",
  "type": "send_artifact",
  "terminal": { "kind": "alias", "value": "worker" },
  "source": {
    "kind": "step_artifact",
    "stepId": "merge_review_outputs",
    "artifact": "merged_text"
  }
}
```

`capture-source` 输出 artifact：

* `captured_text`

`merge_parallel_results` 输出 artifact：

* `merged_text`

## Reference Scope

V0 引用规则保持简单严格。

术语：`visible predecessor scope` 指“外层 block 在进入当前 block 前已经存在的 outputs”加上“当前 block body 中位于当前节点之前的 sibling outputs”。它不是只表示同一层 sibling。

规则：

* JSON 必须显式写 `stepId` 和 `artifact`。
* 当前节点可以引用 `visible predecessor scope` 中的 outputs。
* 当前 block 的前序 sibling outputs 和外层 block 的已存在 outputs 都属于 visible predecessor scope。
* 不允许引用后面的 step。
* 不允许跨 sibling branch 引用。
* if/elif/else branch 内产出的结果不泄漏到 branch 外。
* `merge_parallel_results.source.stepId` 必须引用 `visible predecessor scope` 中的前序 `parallel_all`。
* `parse.source` / `send_artifact.source` 必须引用 `visible predecessor scope` 中的前序 artifact-producing step。

这个规则用于 validator 判断合法性。runner 不应靠“前一个 parallel”或“前一个 merge”自动猜。

## Legacy Compatibility

v1 兼容层规则：

* `schemaVersion: 1` 模板继续可读、可导入、可执行。
* v1 `parallel_all.lanes[*].steps` 继续按现有 runner 语义执行。
* Flow V2 新建模板不生成 v1 lane `steps`。
* Flow V2 validator 不接受 v1 lane `steps`。
* GUI 可以显示 legacy template，但必须带 legacy badge，不把 v1 节点放入新建主路径。

## Compiler Input Requirement

后续 Flow V2 compiler/interpreter 只能接受单一 AST：

```text
FlowV2Template.body -> FlowV2Node[]
parallel_all -> restricted fan-out/fan-in action
merge_parallel_results -> artifact-producing action
```

不允许 compiler 在新模板路径同时解释：

* v2 block-tree
* v1 flat `steps`
* v1 lane `steps`
* lane-local workflow 子语言
* `next/branch/goto/loopGuard`

如果需要执行 legacy v1 template，应走独立 legacy adapter 或现有 v1 runner，不把 v1 语法混入 Flow V2 compiler。

## Migration Direction

后续迁移必须显式预览：

* `complete` -> `return`
* `pause` -> `sleep mode=until-resume`
* `branch` -> `if/elif/else`
* `goto + loopGuard` -> `for` / `break` / `continue`，仅限可证明等价的简单模式。
* v1 `parallel_all.lanes[*].steps` -> 受限 `parallel_all` + `merge_parallel_results` + `parse` / `send_artifact`，仅限线性 send/wait/capture/parse/success 的简单 lane。

复杂 v1 graph 不能静默迁移，只能保留 legacy 或要求用户人工重写。

## Acceptance Criteria

本任务文档 Gate 通过时，应能回答：

* Flow V2 是否允许保存 `next/branch/goto/loopGuard`？答案：不允许，嵌套对象里也不允许。
* `parallel_all` lane 是否仍使用 v1 lane 子语言？答案：不允许。
* `parallel_all` lane 是否是完整 Flow V2 block-tree？答案：不是；V0 收窄为 send/wait/capture。
* 并发结果如何解析？答案：先 `merge_parallel_results` 机械合并，再 `parse` 合并 artifact。
* 合并结果如何发给另一个 terminal？答案：用 `send_artifact` 显式引用 `merged_text`。
* v1 是否被删除？答案：不删除，只保留 legacy 兼容层。
* compiler/interpreter 应吃什么输入？答案：单一 Flow V2 AST，`parallel_all` 是受限 action，不是 lane-local 子语言。
