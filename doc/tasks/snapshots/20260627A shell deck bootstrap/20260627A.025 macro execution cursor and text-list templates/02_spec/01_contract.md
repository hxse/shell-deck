# Contract

## 任务边界

本任务交付一个静态 text-list loop、显式 scoped template 和通用的正常 pause/resume continuation。Macro template 继续使用 `schemaVersion: 2`；既有 count/forever range、普通 text parts 和 scalar strings 保持有效且保持原语义。

以下内容阻断交付：正常 pause/wait/input resume 重复已完成的动态 action；同一 iteration 的 artifact 引用解析到其它 iteration；普通 literal text 被插值；template 在无有效 binding 时仍可保存或启动；nested/parallel execution 串用错误 binding；validator、runner 与 editor 对可模板字段或 scope 的判断不一致。

停止线是同一 `MacroRunnerService` 生命周期内的正确 continuation。Server restart 后重建 in-flight interpreter、外部 terminal write 与 event append 的 crash-atomicity、自定义变量和通用表达式属于范围外，不阻断本任务。

## 任务规范

### 术语与公开类型

`text-list for` 是 range 为 `{ "kind": "text-list", "items": string[] }` 的 for node。每轮把当前 item 绑定为 `text`。

`literal text` 是既有 string 或 `{ "kind": "text", "text": string }`。它从不解析双花括号。

`template text` 是用户显式开启的 `{ "kind": "template", "template": string }`。它只在存在 enclosing text-list binding 时合法。

公开类型新增：

```ts
type FlowV2ForRange =
  | { kind?: "count"; count: number }
  | { kind: "forever" }
  | { kind: "text-list"; items: string[] }

type ScopedTemplateText = { kind: "template"; template: string }
type TemplatableScalarText = string | ScopedTemplateText

type MessagePart =
  | { kind: "text"; text: string }
  | { kind: "template"; template: string }
  | { kind: "artifact"; source?: FlowV2ArtifactSource }
```

`NotifyNode.title`、`InputNode.prompt` 和 `wait.user-continue.prompt` 改为 `TemplatableScalarText`。`send.message` 与 `notify.message` 使用新增 template part。既有 scalar string 是 literal；不引入 `{ kind: "text" }` scalar wrapper，也不自动迁移模板。

### Text-list range contract

* Range 必须精确使用 `kind: "text-list"` 和 `items`；`list`、`texts`、`values`、`as` 等别名都是 unknown/invalid fields。
* `items` 必须是至少包含一项的 array，每项必须是 string。单项允许是空字符串。
* 顺序、重复、Unicode、换行和首尾空白原样保留；runner 和 editor 都不得 trim、去重或按行拆分。
* Item 是原始 binding value，不在进入 loop 时递归解释；item 自己包含 `{{text}}` 时仍是普通字符。
* 每轮创建 immutable binding。模板对象和 items array 在运行前后必须保持不变。

### Template token contract

* 唯一合法 token 是 exact `{{text}}`。不支持 whitespace variant、path、filter、function、default、escape、index 或任意其它变量。
* 一个 template 可以出现多个 `{{text}}`；render 对原始 template 做一次 replacement。替换进去的 item 不再扫描。
* Template 必须至少包含一个 `{{text}}`。其它 `{{...}}`、未闭合 `{{` 或孤立 `}}` 在 validation 阶段失败。
* 需要发送 literal 双花括号时使用普通 text/string，不在 template 内引入第二套 escaping grammar。
* Artifact 内容、input runtime text、capture text 和已经 render 的结果永不二次插值。

### 合法内容 surface

| 位置 | Template 支持 |
| --- | --- |
| `send.message.parts[]` | 支持 template part |
| `notify.title` | 支持 template scalar |
| `notify.message.parts[]` | 支持 template part |
| `input.prompt` | 支持 template scalar；用户实际提交内容不插值 |
| `wait.user-continue.prompt` | 支持 template scalar |
| parallel lane 内的 `send.message` | 若 parallel 位于有效 scope，支持 |
| condition/filter/extract matcher 与 regex | 不支持 |
| parallel lane label、merge separator | 不支持；separator 保留现有单花括号 grammar |
| control reason、node/lane/output id | 不支持 |
| terminal ref、artifact source、profile id | 不支持 |

Template capability 由字段语义决定，不由 TypeScript/JSON 的 `string` 类型机械推导。`capture-source` 没有合适的用户配置内容文本，因此不新增 template surface。

所有 UI text box 的 checkbox 唯一名单、无 scope 状态和明确排除项以同目录 `02_template_checkbox_matrix.md` 为正式 contract。该矩阵不是示例；validator、editor 和测试都必须逐项对齐。

### Lexical scope 与嵌套

Validator、editor 和 runner 都维护 text binding stack：

* Root body 没有 binding。
* text-list for push 当前 binding；离开 body 后 pop。
* if/elif/else、finish/break/continue action-only body 和 parallel lane body 继承当前 binding。
* 内层 count/forever 不创建 binding，继续继承外层 `{{text}}`。
* 内层 text-list push 新 binding，并 shadow 外层；退出内层后恢复外层。
* 第一版没有 outer binding 访问语法。需要同时引用两层 item 时模板必须 validation fail，而不是猜测。

Template node 被移动到无 text-list ancestor 的位置后保持原类型并产生 field-local validation issue；store/import 返回 `invalid_macro_template`，start preflight 返回 `preflight_failed`。系统不得静默转 literal、填空字符串或忽略 token。

### Execution cursor 与 invocation identity

正常 Pause/Resume 的主真值是 execution cursor，不是静态 `completedSteps`。Cursor 至少能表达 sequence 的下一位置、for 的 range/iteration/binding、已选择的 if branch、parallel 各 lane 的位置，以及 wait/input/agent-event capture 的 suspension payload。

每次动态 node execution 都有 occurrence-aware identity：

```ts
type ExecutionPathSegment =
  | { kind: "for"; stepId: string; iterationIndex: number }
  | { kind: "parallel-lane"; stepId: string; laneId: string }

type InvocationRef = {
  stepId: string
  executionPath: readonly ExecutionPathSegment[]
}
```

例如第二轮外层 loop、第三轮内层 loop 的 send 与第一轮不是同一 invocation。Cursor 内部 frame 的具体 class/helper 可以调整，但以下不变量固定：

1. Pause 在安全 action boundary 生效。不可取消的 terminal/notification side effect 已开始时，runner 先让该 action 完成并记录结果，再停在下一 invocation；不得暴露“半个 send”。
2. Wait、input 和等待新事件的 agent-event capture 是显式 suspension point。Duration wait 保存剩余时间并在 resume 后继续剩余部分；user-continue 完成原 invocation；input submit 完成原 invocation 后进入下一位置；agent-event capture 继续同一个 producer occurrence，不能重跑前置 send。
3. Terminal-quiet 在手动 pause 时冻结剩余 timeout budget；resume 后基于当前 terminal 状态重新建立 quiet observation，暂停期间发生的输出不能被当作不存在。
4. If 在选择 branch 后保存选择；branch body 中暂停时，resume 不重新判断 condition。
5. For 保存当前 iteration 和 body cursor。`continue` 推进当前 frame，`break` 完成当前 loop，`finish` 按既有控制传播；count、forever、text-list 共用相同算法。
6. Parallel 为每个 lane 保存独立 cursor；resume 只继续未完成 lane，不能因其它 lane 的同名静态状态而跳过或重跑。
7. Static step completion 可以继续作为 UI summary，但不能决定动态 control flow。
8. Agent-event baseline、已消费 event identity 和 capture waiting state 必须绑定到 InvocationRef；循环下一轮只能消费符合该轮 baseline 的新事件，resume 当前轮不能丢失或重复消费事件。
9. 一个 action 内含多个外部效果时必须保存 sub-invocation outcome。以 notify 为例，某 channel 成功、Telegram 失败并 pause 后，resume 只允许重试失败 channel，不得再次广播或投递已经成功的 channel。

### Binding 与 artifact occurrence

Binding 通过 immutable execution context 向下传递，禁止使用共享可变 `runtime.currentText`。Parallel lanes 获取同一 iteration binding 的不可变快照；内层 text-list 创建新 context，不能污染 sibling 或 outer context。

Artifact environment 同样是 occurrence-aware。静态 `step_artifact.stepId` 继续作为模板引用，但 runtime 必须从当前 lexical execution context 解析 producer occurrence：优先当前 iteration/lane 的可见 predecessor，允许继承 outer predecessor，禁止读取 sibling lane、未来 occurrence 或上一 iteration 的局部 producer。每轮 capture 产生独立 artifact ref；恢复后仍解析到暂停所在 iteration 的 ref。

### Run events 与失败语义

新增 `loop_iteration_started` 和 `loop_iteration_completed`。Loop、step、terminal send、capture、parallel lane、pause 和 resume 相关 event data 应携带结构化 `executionPath`；iteration event 至少记录 zero-based `iterationIndex`、one-based `iteration`、range kind 和有限 range total。当前 item 不裸写 JSONL；如需审计 binding，写 text artifact 并记录 artifact ref/char count。`terminal_text_sent` 继续用 rendered content artifact 证明实际发送内容。

`run_paused` / `run_resumed` 必须记录可读的当前/下一 invocation 位置。旧 run logs 仍可 replay；缺少 executionPath 表示 legacy static occurrence，不允许因此伪造可恢复 cursor。

Runtime 若在 delivery 前发现 template binding 缺失，使用稳定错误 `missing_template_binding` 暂停当前 run，且本次 send/notify/request 不得产生部分 delivery。Notify title 与 message 必须全部 render 成功后才能开始任一 channel delivery。

本任务保证正常 in-process pause/resume 不重复 event-logged side effect。Terminal write 成功但 event/checkpoint 未写入时的 process crash window 继续按现有 run-log contract 记录为残余风险，不得宣称 exactly-once。

### Editor contract

For Mode 增加 `text-list`。Items 使用独立 multiline textarea cards，并提供 Add、Remove、Up、Down；不得使用“一行一个 item”或逗号分隔。切离 text-list 若会丢失非默认 items，必须确认。

每个合法内容字段/part 使用默认关闭的 `Use {{text}} template` checkbox：

* Message part 按 part 切换，不是整个 action 一起切换。
* 开启时保持正文不变，并把底层 literal 形态转换为 template 形态；关闭时无损转回 literal。
* 开启后显示 `Available: {{text}} · from <for-id>` 和 `Insert {{text}}`；nested shadow 必须显示当前来源。
* 空正文开启 template 时可以处于 editor draft invalid 状态，保存/启动前必须补 token。
* 移出 scope 后保留勾选与内容，显示 inline issue；用户取消勾选即可显式修复。
* Collapsed for summary 至少显示 `text-list`、`{{text}}` 和 item count。

## 示例

主链示例：

```json
{
  "id": "for_phases",
  "type": "for",
  "range": {
    "kind": "text-list",
    "items": [
      "\n阶段 1：处理信号最多的三个策略\n",
      "-----------------阶段一-------------\n阶段 2：处理中高频回踩和边界策略\n"
    ]
  },
  "body": [
    {
      "id": "send_phase",
      "type": "send",
      "terminal": { "kind": "id", "value": "term_aUDXou5otSicTHojxKherm" },
      "message": {
        "parts": [{ "kind": "template", "template": "{{text}}" }]
      },
      "enter": true
    },
    {
      "id": "capture_phase",
      "type": "capture-source",
      "capture": {
        "kind": "agent-event",
        "terminal": { "kind": "id", "value": "term_aUDXou5otSicTHojxKherm" },
        "agent": { "kind": "codex" },
        "captureMode": "result_only"
      }
    },
    {
      "id": "send_phase_result",
      "type": "send",
      "terminal": { "kind": "id", "value": "term_du2xUmWdmF1Pji44PJWkRz" },
      "message": {
        "parts": [{ "kind": "artifact", "source": { "kind": "step_artifact", "stepId": "capture_phase", "artifact": "captured_text" } }]
      },
      "enter": true
    }
  ]
}
```

Scalar template 示例：

```json
{
  "id": "confirm_phase",
  "type": "wait",
  "mode": "user-continue",
  "prompt": { "kind": "template", "template": "确认 {{text}} 已处理完成后继续" }
}
```

普通 text 仍为 literal：

```json
{ "kind": "text", "text": "把 {{text}} 原样发送" }
```

以下 template 位于 root，无 binding，必须 validation fail：

```json
{
  "id": "invalid_root_send",
  "type": "send",
  "terminal": { "kind": "alias", "value": "worker" },
  "message": { "parts": [{ "kind": "template", "template": "{{text}}" }] },
  "enter": true
}
```

## 测试

Schema/validator 必须证明 text-list/items 正反例、literal/template 区分、所有合法内容 surface、无 scope template、unknown/malformed token、unknown range aliases、nested inheritance/shadow 和移动节点后的 path-local issue。

Runner 必须证明两项 text 顺序和字节级 rendered content；空字符串、Unicode、换行、多 token 和不递归 expansion；当前 iteration artifact resolution；outer text-list + inner count、nested text-list、if/control body 和 loop 内 parallel binding；模板对象执行前后不变。

Resume 回归必须覆盖 send 后 duration wait、user-continue、input submit、agent-event capture waiting、terminal-quiet pause、partial notify failure、nested loop 中途暂停、if branch 中途暂停和 loop 内 parallel lane。每个动态 invocation/sub-invocation 的外部 side effect 只能成功一次；恢复位置、iteration、binding、AgentEvent consumption、notify channel outcome、artifact ref 和 event executionPath 必须一致。相同 no-duplicate contract 同时覆盖既有 count/forever。

Editor E2E 必须逐项覆盖 `02_template_checkbox_matrix.md` 的 S1-S6 和明确排除组，并覆盖 multiline items 增删改排序和 reload 保真、Insert token、scope source/shadow badge、literal 双花括号、节点移出/移回 scope、inline validation、collapsed summary 和窄宽度嵌套布局。

Close Gate：

* `just test-025`
* `just check`
* `just test-unit`
* `git diff --check`
* AI post-review 未发现 P1/P2，相关 active specs、task index 与最终源码一致。
