# Contract

## 任务边界

本任务新增 V0 唯一有限并发原语 `parallel_all`。它只在单个 macro run 内并发执行多个 lane；同一个 config 仍然最多只有一个 live macro run。完成后，用户可以把多个不同 terminal 作为并发审阅目标，分别发送文本、等待返回、抓取用户选择的 capture source、调用 `regex` 或 `ai-json` parser，并用结构化条件判断全部 lane 是否成功。

范围内：

* `parallel_all` step schema。
* lane 级线性步骤执行。
* lane 级 terminal ref resolution 和 duplicate terminal preflight。
* lane 级 capture/parser reuse，不新增专用 capture/parser。
* lane success condition evaluation。
* all-success join。
* pause/resume idempotency，避免重复发送已完成 send step。
* per-lane event log、artifact 和 UI 展开日志。

范围外：

* 不允许同一 config 多个 macro run 并发。
* 不实现 terminal lock scheduler。
* 不支持 lane 内控制流或人工输入。
* 不支持 nested `parallel_all`。
* 不支持 lane 动态生成；V0 lanes 必须在 template 中静态列出。
* 不新增 capture source、parser kind 或 branch expression DSL。
* 不实现完整嵌套 lane step/success condition 可视化编辑器；`.008` 使用 JSON preview/import/export 承载 lane 内部结构。
* 不实现 send 已到 terminal 但 event 未落盘的 crash recovery unknown 用户选择流。

## 任务规范

### Product Rule

`parallel_all` 是一个 macro step，不是一个新的 run。执行时 run state 仍然只有一个 live run，event log 仍然是唯一真值。UI 可以把 `parallel_all` 显示成一个父节点，默认折叠；展开后显示每个 lane 的输入、等待、capture、parser、condition、artifact 和失败原因。

### ParallelAllStep Schema

V0 最小 schema：

```json
{
  "id": "parallel-review",
  "type": "parallel_all",
  "lanes": [
    {
      "id": "docs-review",
      "terminal": { "kind": "alias", "value": "reviewer1" },
      "steps": [
        { "id": "send-docs", "type": "send_line", "text": "审查文档，只输出 P1/P2/P3。" },
        { "id": "wait-docs", "type": "wait", "mode": "capture-ready-or-user", "captureStep": "capture-docs", "timeoutMs": 600000, "onTimeout": "pause" },
        { "id": "capture-docs", "type": "capture-source", "capture": { "kind": "agent-event", "agentKind": "codex", "eventKind": "agent.output", "adapter": "codex-stop-hook", "terminal": { "kind": "alias", "value": "reviewer1" } } },
        { "id": "parse-docs", "type": "parse", "captureStep": "capture-docs", "parser": { "kind": "ai-json", "profileId": "review-routing-v1" } }
      ],
      "success": {
        "fromParseStep": "parse-docs",
        "mode": "all",
        "conditions": [
          { "signal": "onlyP3OrClean", "op": "==", "value": true }
        ]
      }
    },
    {
      "id": "tests-review",
      "terminal": { "kind": "index", "value": 3 },
      "steps": [
        { "id": "send-tests", "type": "send_line", "text": "审查测试，只输出是否有阻断问题。" },
        { "id": "wait-tests", "type": "wait", "mode": "terminal-quiet", "terminal": { "kind": "index", "value": 3 }, "quietMs": 1000, "maxMs": 600000, "onTimeout": "pause" },
        { "id": "capture-tests", "type": "capture-source", "capture": { "kind": "terminal-buffer", "terminal": { "kind": "index", "value": 3 }, "mode": "scrollback-tail", "maxChars": 12000 } },
        { "id": "parse-tests", "type": "parse", "captureStep": "capture-tests", "parser": { "kind": "regex", "rules": [{ "signal": "hasBlockingIssue", "type": "boolean-null", "pattern": "P1|P2", "flags": "i", "onMatch": true, "onNoMatch": false }] } }
      ],
      "success": {
        "fromParseStep": "parse-tests",
        "mode": "all",
        "conditions": [
          { "signal": "hasBlockingIssue", "op": "==", "value": false }
        ]
      }
    }
  ],
  "join": { "mode": "all_success", "onLaneFail": "pause", "onTimeout": "pause" },
  "next": "merge-review-results"
}
```

### Lane Rules

* `lanes[].id` 使用 root Identifier Contract，并且在当前 `parallel_all` 内唯一。
* 每个 lane 必须声明一个 primary `terminal`，可以是 index、id 或 alias。preflight 必须解析到 stable `terminalId`。
* V0 要求每个 lane 的 primary `terminalId` 互不相同；重复 terminal 是 preflight fail。
* lane 内允许的 step type 只有 `send_line`、`sleep`、`wait`、`capture-source`、`parse`。
* lane 内步骤是线性的，按数组顺序执行；不支持 `next`、`goto`、`branch` 或循环。
* lane 内 `send_line` 默认继承 lane primary terminal。若显式写 terminal，必须解析到同一个 primary `terminalId`。
* lane 内 `wait.terminal`、capture source terminal filter 和 AgentEvent terminal filter 必须与 lane primary `terminalId` 一致；否则 preflight fail。
* lane 必须至少包含一个 `send_line`、一个 `wait`、一个 `capture-source` 和一个 `parse`。
* lane 内 `wait` 不生成 capture artifact；`parse.captureStep` 必须引用本 lane 内已完成的 `capture-source` 产出 artifact。
* lane success 必须引用本 lane 内的 parse step，不能引用其它 lane 或父 graph 的 parse result。

### Capture And Parser Reuse

`parallel_all` 不定义专用抓取或解析机制。lane 内的 `capture-source` 和 `parse` 必须完全复用 `.006` 和 `.007` 已实现的通用能力：

* `terminal-buffer` 抓屏 + `regex` parser + typed condition。
* `terminal-buffer` 抓屏 + `ai-json` parser + typed condition。
* `agent-event` / Codex Stop hook capture + `ai-json` parser + typed condition。
* `agent-event` / Codex Stop hook capture + `regex` parser + typed condition。

parser normalize 规则不变：`true/false/null` 是 typed value，字符串只允许在 normalize 阶段转换，condition compare 不做 `"true" == true` 宽松比较。

### Lane SuccessCondition

Lane success condition 复用 BranchCondition 的 `signal`、`op`、`value` 类型规则，但不带 `goto`：

```json
{
  "fromParseStep": "parse-docs",
  "mode": "all",
  "conditions": [
    { "signal": "onlyP3OrClean", "op": "==", "value": true },
    { "signal": "needsUserDecision", "op": "!=", "value": true }
  ]
}
```

V0 只支持 `mode=all`。所有 condition 都通过时 lane 成功；任一 condition 不通过、signal 为缺失字段、类型不匹配、parser 失败或 parser result schema validation 失败时，lane 失败。`op=is_null` 只匹配显式 typed `null`。

### Join And Failure

`parallel_all.join.mode` V0 只支持 `all_success`。全部 lane 成功后进入父 step 的 `next`。

失败语义：

* 任一 lane timeout，按该 wait step 的 `onTimeout=pause|fail` 处理整个 run。
* 任一 lane parser/schema validation 失败，整个 run pause/fail，并记录 lane id、step id、artifact refs 和错误原因。
* 任一 lane success condition 不通过，整个 run 按 `join.onLaneFail=pause|fail` 处理。
* 用户可以 stop 整个 run；V0 不支持只取消单个 lane 后继续 join。

### Resume And Idempotency

恢复时必须从 event log 重建每个 lane 状态：`pending`、`running`、`waiting`、`succeeded`、`failed`。已写入 `terminal_line_sent` 的 lane send step 不得重复发送。已经成功的 lane 不得重跑 capture/parser，除非用户明确 reset 整个 `parallel_all` step。

V0 只承诺正常 pause/resume 不重复发送已经写入 `terminal_line_sent` 的 lane send step。server crash 发生在 terminal 已收到输入但 event 未落盘之前的极端窗口不在 `.008` 范围内；后续 recovery task 需要单独设计 lane 级 unknown 状态和用户选择流。

### Event Integration

至少新增或复用这些 event：

* `parallel_all_started`
* `parallel_lane_started`
* `parallel_lane_step_started`
* `parallel_lane_step_completed`
* `parallel_lane_waiting`
* `parallel_lane_parser_normalized`
* `parallel_lane_condition_evaluated`
* `parallel_lane_succeeded`
* `parallel_lane_failed`
* `parallel_all_joined`

事件必须包含 `runId`、`stepId`、`laneId`、lane step id、`eventSeq` 和必要 artifact refs。UI lane 日志和 AI 追溯日志都从同一份 event log 派生。

## 示例

```text
1. parallel_all_started step=parallel-review lanes=[docs-review,tests-review]
2. parallel_lane_started lane=docs-review terminalId=term_a1
3. parallel_lane_started lane=tests-review terminalId=term_b2
4. terminal_line_sent lane=docs-review laneStepId=send-docs terminalId=term_a1
5. terminal_line_sent lane=tests-review laneStepId=send-tests terminalId=term_b2
6. capture_artifact_created lane=docs-review laneStepId=capture-docs captureKind=agent-event terminalId=term_a1 artifactRef=artifacts/parallel-capture-agent-...txt rawArtifactRef=artifacts/parallel-agent-event-raw-...json
7. parallel_lane_parser_normalized lane=docs-review laneStepId=parse-docs parser=ai-json artifactRef=artifacts/parser-ai-json-normalized-...json rawArtifactRef=artifacts/parser-ai-json-raw-...json inputArtifactRef=artifacts/parser-input-...txt
8. parallel_lane_condition_evaluated lane=docs-review laneStepId=parse-docs signal=onlyP3OrClean result=pass
9. capture_artifact_created lane=tests-review laneStepId=capture-tests captureKind=terminal-buffer terminalId=term_b2 artifactRef=artifacts/parallel-capture-terminal-normalized-...txt rawArtifactRef=artifacts/parallel-capture-terminal-raw-...txt normalizedArtifactRef=artifacts/parallel-capture-terminal-normalized-...txt
10. parallel_lane_parser_normalized lane=tests-review laneStepId=parse-tests parser=regex artifactRef=artifacts/parser-regex-normalized-...json rawArtifactRef=artifacts/parser-regex-raw-...json
11. parallel_lane_condition_evaluated lane=tests-review laneStepId=parse-tests signal=hasBlockingIssue result=pass
12. parallel_all_joined result=all_success next=merge-review-results
```

## 测试

自动化测试至少覆盖：

* unit：`parallel_all` schema validation，lane id 唯一，lane step id 唯一。
* unit：duplicate lane primary terminal preflight fail。
* unit：lane 内显式 terminal、wait terminal、capture source terminal 与 primary terminal 不一致时 preflight fail。
* unit：lane allowed step types；嵌套 `parallel_all`、`input_line`、`branch`、`goto`、回跳循环、`for_each` 等非法。
* unit：lane success condition 复用 typed BranchCondition 规则，不允许字符串宽松比较。
* unit：`all_success` join、condition fail pause/fail、timeout pause/fail。
* unit：resume 不重复发送已写入 `terminal_line_sent` 的 lane send step。
* integration：两个 fake terminal 并发 `terminal-buffer -> regex -> success`。
* integration：两个 fake terminal 并发 `terminal-buffer -> mock ai-json -> success`。
* integration：两个 AgentEvent source 并发 capture 后进入 mock parser。
* integration：一个 lane 成功、一个 lane condition fail，整个 run pause 且节点日志指出失败 lane。
* e2e：并发审阅模板运行、全部 lane 成功后进入 next，刷新后展开 per-lane 日志仍一致。

V0 closeout manual smoke 至少覆盖：

* 人工创建两个 reviewer terminal，运行 `parallel_all` 并确认两个 terminal 都收到文本。
* 分别测试 terminal-buffer + regex、terminal-buffer + mock ai-json、Codex hook AgentEvent + mock ai-json 三条 lane 组合。
* 人工制造一个 lane timeout 或 condition fail，确认整个 run pause，UI 能定位 lane 和 artifact。
* 刷新页面后恢复 run，确认已发送 lane 不会重复发送。

Gate 规则：

* `just check`、`just test-unit`、`just test-e2e`、`just test-008-offline` 必须通过。
* online AgentEvent/Codex hook smoke 可选；不可用时记录 blocked reason，不阻断 offline Gate。
* `.008` 不强制人工 smoke；人工 smoke 延后到 V0 closeout 统一执行并写入对应 review/verification。
* 若出现同 config 多 live run、lane 重复写同一 terminal、重复发送已完成 lane、或 UI/AI 日志不是同一 event log 派生，不能进入 `.009`。
