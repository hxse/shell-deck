# Contract

## 任务边界

本任务让宏真正运行，但只依赖 mock capture/parser stub。完成后，一个模板可以在当前 config 下把 terminal ref 解析为 stable terminal id，对 terminal 执行 send-line、等待、sleep、input-line、mock capture、mock parse、结构化分支和基础流程控制，并把所有动作写入 `.004` event log。

范围内：

* runner lifecycle。
* TerminalRef resolution by index/id/alias，并使用实时 mapping。
* `send_line` / `wait` / `sleep` / `input_line` / `capture-source` / `parse` stub / `branch` / `goto` / 带 `loopGuard.maxIterations` 的简单回跳循环 / `pause` / `complete` / `fail` / `resume` / `stop`。
* 用户主动 pause/resume/stop，模板可显式 complete/fail；同一 config 内 V0 不允许在已有 live run 时启动第二个 run，不同 config 可以并行运行各自的 macro run。
* mock capture source。
* mock parser result 注入，覆盖 `ai-json` 和 `regex` 两类 parse output shape。
* run log 写入和节点日志数据。

范围外：

* 不实现真实 `terminal-buffer` 截取细节。
* 不实现 AgentEvent ingest。
* 不调用真实 `ai-json` / `codex exec` parser。
* 不实现 parser profile fixture eval。
* 不理解 Codex、shell command、用户拍板等业务语义。

## 任务规范

### Runner lifecycle

runner 必须支持：

* `idle`
* `running`
* `waiting`
* `waiting_user_input`
* `paused`
* `completed`
* `failed`
* `interrupted`
* `stopped`

runner 是傻瓜执行器。它只执行用户配置的步骤，不根据 Codex 文本自行判断要不要继续。遇到 config 不匹配、terminal ref 无法解析、terminal closed、capture source 未配置、parser profile 不存在、regex rule 非法、branch 引用未声明 signal、typed value 不匹配、step 配置缺失、循环作用域非法、artifact 写入失败、parser/schema validation 失败等情况时，必须 pause 或 fail，并写明原因。

### Run concurrency

V0 每个 config 同一时刻最多允许一个 live macro run。live run 包括 `running`、`paused`、`waiting`、`waiting_user_input` 和可恢复的 `interrupted`；不包括 `completed`、`failed`、`stopped`。如果当前 config 已有 live run，启动新 run 必须失败，并返回 existing `runId` 和用户可读提示：先 resume、stop、complete 现有 run，或切换到另一个 config。

不同 config 的 terminal、template、run log、AgentEvent 和 index/id/alias mapping 已隔离，可以并行运行各自的 macro run。这个限制只约束 macro runner 自动执行，不限制用户手动在 terminal 里输入、退出 Codex 或运行 shell command。V0 不实现 terminal-level lock；同 config 多 run 并发若未来需要，必须单独设计 scheduler/lock 任务。

### Step semantics

* `send_line`：把 terminal ref 解析成 `terminalId`，向该 terminal 写入 `text`，然后发送 Enter。runner 不区分 prompt、shell command、Codex 输入或其它 TUI 输入。发送文本必须写 artifact，并写 `terminal_line_sent` event。
* `wait`：按结构化 WaitStep schema 等待 `duration`、`capture-ready-or-user`、`terminal-quiet` 或 `user-continue`。等待期间 run status 是 `waiting`；wait 不生成 capture artifact。runner 不自动选择 capture source，也不接受自然语言 wait condition。
* `sleep`：等待 `durationMs` 毫秒后继续。模板存储统一使用毫秒正整数；UI 可以接受 ms/s/min/h 并保存前转换。sleep start/end 都必须写 event。
* `input_line`：进入 `waiting_user_input`，显示单行输入框。用户输入并回车后，runner 把该文本作为一行发送到指定 terminal，再继续 next step。用户取消时 run 进入 `paused`。输入文本必须写 artifact，并写 `user_input_requested`、`user_input_submitted` 和 `terminal_line_sent` event。
* `capture-source`：调用当前 source adapter，是 V0 唯一的 capture artifact producer。V0 本任务只要求 mock capture，真实 `terminal-buffer` 和 `agent-event` 在 `.006` 实现。
* `parse`：读取同一 run 内对应 source 最近一次已完成 `capture-source` 产出的 capture artifact 并调用 mock parser。`ai-json` 和 `regex` 都必须输出 normalized typed signals；缺少 capture artifact、parser 失败或 schema validation 失败时 pause/fail，不能进入 branch。
* `branch`：结构化 if/else，根据 normalized typed signals 选择下一 step，也可以作为简单循环的停止判断。branch compare 只比较 typed value，不允许 `"true" == true` 这类宽松比较。
* `goto`：无条件跳转到合法 step id。V0 允许跳到前面某一步形成简单循环，但任何回跳边必须声明 `loopGuard`。
* `pause`：显式暂停 run，并记录原因。它不代表任何业务语义，业务语义由用户模板决定。
* `complete`：显式完成 run，进入 `completed`，并记录完成原因。
* `fail`：显式失败 run，进入 `failed`，并记录失败原因。
* `resume`：用户从 paused step、`input_line` 提交后，或用户指定 next step 继续。
* `stop`：用户停止 run，记录 event。

### WaitStep

V0 `wait` step 的 runtime 语义：

* `duration`：等待 `durationMs` 后继续；`durationMs` 必须是毫秒正整数。
* `capture-ready-or-user`：等待 selected capture source readiness，或用户手动继续；它不写 capture artifact，后续 `capture-source` step 才生成 artifact。`.005` mock adapter 默认视为 ready，测试可用 `mockCaptureReady=false` 覆盖 timeout 分支；ready 判断不能依赖 capture artifact 是否已生成。超过 `timeoutMs` 后按 `onTimeout=pause|fail` 处理。
* `terminal-quiet`：resolved terminal 连续 `quietMs` 没有新的 pty output 即继续；总等待超过 `maxMs` 后按 `onTimeout=pause|fail` 处理。
* `user-continue`：只等待用户点击继续，不读取 terminal 或 capture source。

所有 wait mode 都必须写 `wait_started`；正常结束写 `wait_completed`，超时写 `wait_timeout`，人工继续写 `wait_manual_continue`。

### InputLine

`input_line` 是内置交互原语，语义类似 Python `input()`：等待用户输入文字和回车，然后把文字发送到指定 terminal 并继续。等待期间 run status 是 `waiting_user_input`。它只提供工具能力，不替用户解释业务原因。典型配置：

```json
{
  "id": "ask-user-direction",
  "type": "input_line",
  "terminal": "main",
  "prompt": "请输入给目标终端的指示",
  "placeholder": "例如：只修 AI 可直接修的问题",
  "allowEmpty": false,
  "next": "wait-worker"
}
```

### SimpleLoop runtime

V0 支持简单循环，但不实现完整 `for_each`。任何 `next`、`goto`、`branch.conditions[].goto` 或 `branch.else` 指向当前 template 中更早 step 的边都叫回跳边。回跳边所在 step 必须声明：

```json
{
  "loopGuard": {
    "maxIterations": 5,
    "onLimit": "pause"
  }
}
```

运行规则：

* `maxIterations` 必须是正整数，V0 建议最大 100。
* `onLimit` 只支持 `pause` 或 `fail`。达到上限后不能继续回跳。
* runner 必须把每次回跳写入 `control_transition`，并从 event log 重建同一回跳 step 的计数。
* 回跳 limit 命中时必须写 pause/fail reason，UI 节点日志能看到 limit、当前次数和目标 step。
* 未声明 `loopGuard` 的回跳边、嵌套复杂循环、完整 `for_each`、item binding、`break` 和 `continue` 都是 V0 preflight fail。

### Event integration

runner 的每个动作都必须写入 `.004` 定义的 event log。至少新增：

* `terminal_ref_resolved`
* `terminal_line_sent`
* `wait_started`
* `wait_completed`
* `wait_timeout`
* `wait_manual_continue`
* `capture_wait_started`
* `capture_artifact_created`
* `parser_normalized`
* `branch_decision`
* `control_transition`
* `sleep_started`
* `sleep_completed`
* `user_input_requested`
* `user_input_submitted`
* `step_failed`

### Recovery

页面刷新后，用户能看到历史 run、当前状态、节点事件和 artifacts 引用。若 server/PTY 仍在，terminal 可继续同步；若 PTY 丢失，未完成 run 标记为可恢复的 `interrupted`，用户可以重新启动 terminal 内程序后手动继续。若要在同一 config 新开 run，必须先 stop、fail 或 complete 当前 interrupted run；切换到另一个 config 不受影响。

paused run 必须保持可恢复。同一 config 存在 live run 时不能启动另一个 run；用户若要在同一 config 运行别的宏，必须先 stop、complete 或 fail 当前 run。切换到另一个 config 运行宏是允许的，且不能影响当前 config 的 event log 或 pause state。

## 示例

```text
1. run_started config=local
2. step_started ask-review
3. terminal_ref_resolved ref=index:2 -> terminalId=term_7k3p9d
4. terminal_line_sent terminalId=term_7k3p9d textRef=artifacts/send-0001.txt enter=true
5. step_completed ask-review
6. step_started sleep-short
7. sleep_started durationMs=1500
8. sleep_completed
9. step_started capture-review
10. capture_wait_started source=mockReview terminalId=term_7k3p9d
11. capture_artifact_created source=mockReview outputRef=artifacts/capture-0001.txt
12. parser_normalized normalizedRef=artifacts/parser-output-0001.json
13. branch_decision nextStepId=ask-user-direction reason="configured condition matched"
14. user_input_requested step=ask-user-direction
15. user_input_submitted textRef=artifacts/user-input-0001.txt
16. terminal_line_sent terminalId=term_main textRef=artifacts/user-input-0001.txt enter=true
```

## 测试

本任务验证 runner 是可观察、可暂停、可恢复的傻瓜执行器，只接 mock capture/parser。

自动化测试至少覆盖：

* unit：TerminalRef resolution by index、id、alias，且 terminal reorder 后映射正确。
* unit：config isolation for terminal ref resolution。
* unit：runner state transitions，包括 `complete`/`fail` step 进入 `completed`/`failed`。
* unit：同一 config 已有 live run 时启动新 run 被拒绝；completed/failed/stopped run 不阻塞新 run；不同 config 可并行。
* unit：structured wait schema：duration、capture-ready-or-user、terminal-quiet、user-continue、timeout pause/fail。
* unit：`send_line` 写入文本并发送 Enter，不区分 prompt/command。
* unit：`sleep` 使用 `durationMs`，UI ms/s/min/h 转换结果进入模板。
* unit：`input_line` request/submit/cancel 状态和 event log。
* unit：branch unknown 或 parser/schema failure enters pause/fail。
* unit：branch referencing signal outside selected parse output fails preflight。
* unit：branch typed compare 不允许字符串宽松比较。
* unit：回跳 `goto`/`branch` 必须声明 `loopGuard`，达到 `maxIterations` 后按 `onLimit` pause/fail；未声明 guard 的回跳 preflight fail。
* unit：missing capture source enters pause。
* integration：`send_line -> sleep -> wait -> capture-source -> parse -> branch -> input_line` against fake terminal and mock capture source，并覆盖一次 branch/goto 简单循环。
* e2e：运行模板、暂停、尝试同 config 启动第二个宏并被拒绝、切换另一 config 启动宏、恢复原 run、展开节点查看同一份 event log。
* e2e：terminal reorder 后，index ref 按当前 mapping 解析，id ref 始终指向同一 terminal。

可选人工 smoke 建议覆盖（不是 Close Gate 必需项）：

* 人工运行 `send_line -> sleep -> input_line -> branch` 模板。
* 在 `input_line` 输入文本并回车，确认文本被发送到目标 terminal 后 runner 继续。
* 暂停宏，确认同 config 不能启动另一个宏；切换到另一个 config 可以运行宏，再回来恢复原 run。
* 在 terminal 里手动输入、退出 Codex 或运行 shell command，确认 runner 不试图理解或接管 terminal 内容。
* 展开节点日志，确认每一步都有 event 和 artifact 证据。

Gate 规则：

* `just check`、`just test-unit`、`just test-e2e`、`just test-005` 必须通过。
* 人工 smoke 若执行，结果写入 `04_review/**`；未执行人工 smoke 不阻断 Close Gate。
* runner 出现不可观察后台继续、自动解释业务语义或丢失 pause state 时不能进入 `.006`。
