# Contract

## Scope

本任务定义 Macro Flow V2 的设计蓝图。

范围内：

* GUI 分栏：Actions 与 Flow Control 分开显示。
* 新的 block-tree template schema 方向。
* Python-like flow naming。
* 旧流程控制 step 的迁移映射。
* `sleep` 的新语义。
* 流程控制可观测性和 run log 命名原则。

范围外：

* 不在本任务实现 runner interpreter/compiler。
* 不在本任务删除旧 v1 template。
* 不在本任务迁移用户数据。
* 不引入 Python 代码执行。
* 不支持字符串表达式，例如 `if x == true`。

## Design Principles

1. Actions 和 Flow Control 在 GUI 中分离。
2. Template 存储必须是结构化 JSON。
3. Flow Control 名称接近 Python，但不是 Python runtime。
4. 不暴露 `goto` 作为新 GUI 的主要能力。
5. `pause` / `stop` 不进入模板流程控制。
6. `sleep` 是普通动作，可定时，也可等待用户 Resume。
7. 旧模板继续可读；新模板默认使用 Flow V2。
8. run log 仍是唯一真值，不能因为 block-tree 新增第二份执行真值。

## GUI Layout

建议 GUI 分为三块：

### Actions Palette

只放普通动作：

* `send_line`
* `input_line`
* `sleep`
* `wait`
* `capture`
* `parse`
* `parallel_all`

这些节点负责“做事”，不决定复杂流程走向。

### Flow Palette

只放流程控制：

* `if`
* `elif`
* `else`
* `for`
* `break`
* `continue`
* `return`

明确不放：

* `pause`
* `stop`
* `goto`
* `branch`
* `complete`
* `fail`

说明：

* `pause` 是顶部控制按钮，不是 template step。
* `stop` 是顶部控制按钮，不是 template step。
* `complete` 在新范式中改名为 `return`。
* `branch` 在新范式中改为 `if/elif/else`。
* `goto + loopGuard` 在新范式中改为 `for/break/continue`。
* `fail` 暂不进入 Flow V2 主 palette；如果后续需要脚本级异常，再单独设计 `raise`。

### Block Tree Editor

中心编辑区用缩进线展示流程结构：

```text
for round in range(3)
│ send_line reviewer
│ wait terminal quiet
│ capture review
│ parse review
│ if onlyP3OrClean == true
│ │ return "review clean enough"
│ elif needsUserDecision == true
│ │ input_line user -> worker
│ │ continue
│ else
│ │ send_line worker "fix these issues"
│ │ wait worker quiet
│ │ continue
sleep until resume "loop limit reached"
return "manual follow-up accepted"
```

展示要求：

* 嵌套块必须有清晰竖线或缩进。
* `if/elif/else` 必须作为一个连续 group 展示，不能散落成多个孤立节点。
* `for` 的 body、`if` 的 branch body、`else` body 必须可折叠。
* 选中节点后，右侧 inspector 编辑该节点参数。
* 旧 v1 节点如果被打开，应显示 legacy badge，不鼓励继续创建。

## Flow V2 Schema Direction

新模板建议使用 `schemaVersion: 2` 和 block-tree：

```json
{
  "schemaVersion": 2,
  "id": "review_loop_v2",
  "name": "Review Loop V2",
  "configId": "local",
  "body": [
    {
      "id": "review_loop",
      "type": "for",
      "range": { "count": 3 },
      "body": [
        {
          "id": "send_review",
          "type": "send_line",
          "terminal": { "kind": "alias", "value": "reviewer" },
          "text": "审查当前修改"
        },
        {
          "id": "capture_review",
          "type": "capture-source",
          "capture": {
            "kind": "terminal-buffer",
            "terminal": { "kind": "alias", "value": "reviewer" },
            "mode": "scrollback-tail",
            "maxChars": 12000
          }
        },
        {
          "id": "parse_review",
          "type": "parse",
          "captureStep": "capture_review",
          "parser": { "kind": "ai-json", "profileId": "review-routing-v1" }
        },
        {
          "id": "route_review",
          "type": "if",
          "branches": [
            {
              "kind": "if",
              "condition": {
                "fromParseStep": "parse_review",
                "signal": "onlyP3OrClean",
                "op": "==",
                "value": true
              },
              "body": [{ "id": "return_clean", "type": "return", "reason": "review clean enough" }]
            },
            {
              "kind": "elif",
              "condition": {
                "fromParseStep": "parse_review",
                "signal": "needsUserDecision",
                "op": "==",
                "value": true
              },
              "body": [
                {
                  "id": "ask_user",
                  "type": "input_line",
                  "terminal": { "kind": "alias", "value": "worker" },
                  "prompt": "需要人工拍板",
                  "allowEmpty": false
                },
                { "id": "continue_after_user", "type": "continue" }
              ]
            }
          ],
          "else": [
            {
              "id": "send_fix",
              "type": "send_line",
              "terminal": { "kind": "alias", "value": "worker" },
              "text": "修复这些问题"
            },
            { "id": "continue_after_fix", "type": "continue" }
          ]
        }
      ]
    },
    {
      "id": "loop_limit_sleep",
      "type": "sleep",
      "mode": "until-resume",
      "reason": "loop limit reached"
    },
    { "id": "return_after_limit", "type": "return", "reason": "loop limit handled" }
  ]
}
```

## Condition Contract

Flow V2 继续使用结构化 condition，不允许字符串表达式：

```json
{
  "fromParseStep": "parse_review",
  "signal": "onlyP3OrClean",
  "op": "==",
  "value": true
}
```

规则：

* `signal` 必须来自 selected parser 的 declared signals。
* `op` 必须来自 profile 的 allowed operators。
* `value` 必须匹配 signal type。
* 字符串 `"true"` 不等价于 boolean `true`。
* `is_null` 不带 `value`，只匹配显式 `null`。

## Sleep Contract

`sleep` 是 Action，不是 Flow Control。

### Timed sleep

```json
{
  "id": "sleep_short",
  "type": "sleep",
  "mode": "duration",
  "durationMs": 5000
}
```

GUI 可以允许用户选择 ms/s/min/h，但存储统一为 `durationMs`。

### Sleep until resume

```json
{
  "id": "wait_user_resume",
  "type": "sleep",
  "mode": "until-resume",
  "reason": "waiting for user decision"
}
```

语义：

* runner 进入可恢复等待状态。
* UI 显示为 `sleeping` 或 `waiting for resume`，不要显示成 template `pause`。
* 用户点击顶部 `Resume` 后继续执行下一节点。
* 用户点击顶部 `Stop` 后强制终止 run。

## Runner Control Buttons

顶部控制按钮属于 run control，不属于 template language：

* `Start`
* `Pause`
* `Resume`
* `Stop`

规则：

* `Pause`：外部暂停当前 run，不写入 template 逻辑。
* `Resume`：继续当前 run，或继续 `sleep until resume`。
* `Stop`：外部强制终止当前 run。
* Template 内不再创建 `pause` 或 `stop` step。

## Legacy Mapping

V1 flat step / old GUI 名称在 Flow V2 中的映射：

| Legacy | Flow V2 / UI | 说明 |
| --- | --- | --- |
| `complete` | `return` | 正常结束 macro。 |
| `branch` | `if/elif/else` | 保留结构化 condition。 |
| `goto + loopGuard` | `for` / `continue` / `break` | 不再暴露任意跳转。 |
| `pause` step | `sleep mode=until-resume` | pause 不再作为 Flow Control。 |
| `stop` step | 无 | stop 只作为顶部控制按钮。 |
| `fail` step | legacy only | 新 GUI 不放入主 palette；后续若需要异常语义，单独设计 `raise`。 |

兼容要求：

* 旧 `schemaVersion: 1` 模板必须继续可读、可导入、可执行。
* 最终目标是新 GUI 默认创建 `schemaVersion: 2`；当前实现 slice 在 runner 未支持 Flow V2 前继续默认创建 v1，避免生成不可执行模板。
* 旧模板打开时可显示 legacy nodes，但不鼓励继续新增旧 `branch/goto/pause/stop/complete/fail`。
* 自动迁移必须可预览，不允许静默改变用户模板含义。

## Observability

Flow V2 仍然写入同一份 append-only run event log。

要求：

* 每个 block node 有稳定 `nodeId`。
* 嵌套节点在 run log 中保留 block path，例如 `review_loop/route_review/send_fix`。
* `if/elif/else` 需要记录 selected branch。
* `for` 需要记录 iteration index。
* `break` / `continue` / `return` 需要记录控制流事件。
* `sleep until resume` 需要记录进入等待、用户 resume、继续执行。
* 人类 UI 和 AI trace 仍读取同一份 event log。

## Implementation Direction

推荐先实现 compiler，而不是一次性重写 runner：

1. Flow V2 block-tree schema。
2. Flow V2 validator。
3. Flow V2 -> internal execution graph compiler。
4. Runner 使用现有动作执行能力。
5. Run log 增加 block path / iteration metadata。
6. GUI 改为 Actions / Flow palettes 和 block-tree editor。

如果 compiler 复杂度过高，也可以直接做 block-tree interpreter，但必须保持事件写入和恢复语义清晰。
