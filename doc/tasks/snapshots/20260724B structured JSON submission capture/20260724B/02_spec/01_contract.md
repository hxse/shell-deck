# Structured JSON Submission Contract

## 任务边界

本任务扩展current `MacroDefinitionV5`，不读取、更名或迁移旧definition。现有terminal-buffer、text-box、AgentEvent Capture与text artifact读取保持原语义；新增分支必须使用exact current shape，unknown/missing field继续fail loudly。

`structured-json`只允许出现在root Flow `capture-source`。Parallel lane没有If且Output只收集lane-local text，因此本任务不在lane暴露该kind。typed JSON可由`json_match`直接消费，也可由显式的textual consumer统一投影为canonical compact JSON；允许该投影的入口是root/Parallel Send message、Notify message、Input default、Extract Text和`text_match`。Parallel Output继续只接受lane-local text artifact。

本任务不保证一个提交对应某个Send，也不保存submission queue。唯一正式语义是：当前active run中，绑定同一frozen terminal launch的active structured Capture消费一次合法提交。没有active waiter、waiter属于其他terminal、run已终态或runtime identity过期时都拒绝。

停止线是本地、单server、单用户V0主链全绿：CLI可提交、Room隔离成立、schema校验可反馈、artifact typed、If可分支、现有Stop hook和text artifact无回归。不增加step token、Codex session关联、外部schema fetch或跨restart恢复。

## 任务规范

### Macro类型

共享JSON类型为：

```ts
type JsonScalar = string | number | boolean | null
type JsonValue = JsonScalar | JsonValue[] | { [key: string]: JsonValue }
type JsonSchema = boolean | { [key: string]: JsonValue }

type CaptureWaitLimit =
  | { kind: "unbounded" }
  | { kind: "timeout"; timeoutMs: number }
```

root `CaptureSourceConfig`新增：

```ts
{
  kind: "structured-json"
  terminal: MacroTerminalReference
  schema: JsonSchema
  waitLimit: CaptureWaitLimit
}
```

Schema按JSON Schema 2020-12编译。省略`$schema`时也按2020-12解释；真正schema object位置上的`$ref`/`$dynamicRef`只接受以`#`开头的本地fragment，不联网解析外部resource。local-only检查只沿2020-12 subschema keyword下钻；`properties`/`$defs`中的map key即使名为`$ref`，以及`const`、`enum`、`examples`中的普通JSON data，都不当成reference keyword。每次validation独立编译，schema `$id`不能污染其他Macro或让同一saved schema重复校验失败。invalid schema在persistable validation阶段产生stable `invalid_json_schema` issue。Visual editor提供raw schema JSON字段；JSON parse失败或parse成功但schema compile失败的中间文本都必须逐字保留为invalid draft并阻止Save，不能pretty-print或静默保存上一次合法schema。Schema editor复用普通multiline字段的默认自适应高度和手动resize上限，不单独扩大初始行数。

合法Schema旁提供`View suggested prompt`。它只生成包含当前pretty JSON Schema、stdin heredoc命令、`structured_json_submitted`成功条件及schema mismatch重试说明的参考文本，不自动寻找或改写任意Send。完整参考文本用相同的`------------`分隔线在上下包裹；每条分隔线与正文之间保留空行，整个区块前后也各保留换行，便于复制后与外层prompt隔离。点击后用theme-native modal显示完整只读、可聚焦和可选择的文本；modal内`Copy`是快捷方式。clipboard写入失败时modal保持打开并显示手动`Ctrl/Cmd+A`、`Ctrl/Cmd+C`指引，用户仍可自行复制。invalid Schema时入口disabled。

非structured Capture继续只产生`captured_text`；structured Capture只产生`captured_json`，不双写或缓存字符串副本。runtime artifact map保存带kind的value，JSON artifact同时以canonical pretty JSON加末尾LF写入`.json` evidence。

所有允许artifact的textual consumer共用同一read-boundary投影：text value逐字返回；JSON value递归按Unicode code point排序object key，并用无缩进、无末尾换行的JSON表示返回。这样Send的`ending`仍是唯一terminal提交边界，不会因为pretty JSON内的换行意外产生多次输入。数组顺序与scalar类型保持不变。`json_match`继续只接受`captured_json`并保持typed比较；JSON consumer读取text、Parallel Output读取JSON以及runtime source/name与实际value kind不一致都fail loudly，不提供隐式coercion、旧字段或第二份artifact真值。

### 提交入口与Room隔离

唯一CLI入口：

```bash
just submit-json
```

Shell启动时注入canonical absolute `SHELL_DECK_JUSTFILE`，建议提示词从任意cwd统一使用：

```bash
just -f "$SHELL_DECK_JUSTFILE" submit-json
```

recipe不接受Room、terminal、step或token参数，只从stdin读取一个JSON value；实际`submit-json` process要求继承：

```text
SHELL_DECK_SUBMIT_JSON_URL
SHELL_DECK_INGEST_TOKEN
SHELL_DECK_ROOM_GENERATION
SHELL_DECK_TERMINAL_ID
SHELL_DECK_LAUNCH_ID
```

缺少任一项以`structured_json_room_context_required`退出非零。JSON parse失败以`structured_json_invalid_json`退出非零。HTTP非成功时打印server返回的stable error与validation issues并退出非零。

HTTP入口为`POST /api/rooms/:roomId/structured-results`。Body exact shape：

```json
{
  "protocolVersion": 1,
  "roomGeneration": "roomGeneration_...",
  "terminalId": "term_...",
  "launchId": "launch_...",
  "value": {}
}
```

path `roomId`是唯一Room真值，body不能覆盖。server按以下顺序验证：

1. memory-only ingest token；
2. exact body和JSON value；
3. path Room仍active；
4. `roomGeneration + terminalId + launchId`属于该Room；
5. 同一active run正等待该terminal的structured Capture；
6. value符合该Capture冻结的schema。

token错误返回403 `structured_json_ingest_token_invalid`；malformed JSON或非exact body返回422 `structured_json_submission_invalid`；body通过后，malformed path Room id、Room不存在、正在销毁或runtime membership错误统一返回404 `structured_json_runtime_membership_mismatch`。没有匹配waiter返回409 `structured_json_capture_not_waiting`；schema不匹配返回422 `structured_json_schema_mismatch`及确定性issue列表。失败提交不完成Capture。第一份合法提交原子取得waiter并使后续提交得到not-waiting。

Pause期间waiter和已接受value保留，但runner必须在Resume后才能完成当前step。Stop、Room Destroy、server restart或abort清除waiter。timeout只计算active waiting time并以`structured_json_capture_timeout:<terminalId>`令run失败。

### JSON If

If condition新增：

```ts
type JsonMatchCondition = {
  kind: "json_match"
  source: FlowV2JsonArtifactSource
  pointer: string
  matcher:
    | { kind: "exists" }
    | { kind: "not_exists" }
    | { kind: "equals" | "not_equals"; value: JsonScalar }
    | {
        kind: "less_than" | "less_than_or_equal"
          | "greater_than" | "greater_than_or_equal"
        value: number
      }
}
```

`pointer`使用JSON Pointer：空字符串选择root，非空值必须以`/`开始，token只接受标准`~0`和`~1`escape。数组index使用canonical非负十进制且不能用`-`。invalid pointer在Save阶段失败。

`exists/not_exists`只判断目标是否存在。其他matcher在目标缺失时一律false，包括`not_equals`；这样缺字段不能静默进入否定分支。equals/not_equals只比较JSON scalar且保持类型严格；number comparator只有目标为number时才可能true。

### Ownership与evidence

runner lifecycle继续唯一拥有live run。每个run只有一个pending structured Capture引用；HTTP service通过runner facade提交，不读取或复制run map。pending waiter保存step、frozen binding、compiled schema和单次resolver，不成为第二份run state。

合法提交产生`captured_json` artifact及`artifact_created` evidence，记录capture kind、configured/current terminal index、terminalId和launchId；manifest已经冻结schema，不在event中复制schema。非法提交不创建run artifact。

## 示例

Macro主链：

```json
{
  "id": "capture_decision",
  "type": "capture-source",
  "capture": {
    "kind": "structured-json",
    "terminal": { "kind": "terminal_index", "index": 1 },
    "schema": {
      "type": "object",
      "required": ["decision", "confidence"],
      "additionalProperties": false,
      "properties": {
        "decision": { "enum": ["continue", "retry", "stop"] },
        "confidence": { "type": "number", "minimum": 0, "maximum": 1 }
      }
    },
    "waitLimit": { "kind": "unbounded" }
  }
}
```

Codex或普通terminal程序提交：

```bash
printf '%s' '{"decision":"retry","confidence":0.82}' \
  | just -f "$SHELL_DECK_JUSTFILE" submit-json
```

If消费：

```json
{
  "kind": "json_match",
  "source": {
    "kind": "step_artifact",
    "stepId": "capture_decision",
    "artifact": "captured_json"
  },
  "pointer": "/decision",
  "matcher": { "kind": "equals", "value": "retry" }
}
```

Send再次转发同一typed artifact：

```json
{
  "id": "forward_decision",
  "type": "send",
  "terminal": { "kind": "terminal_index", "index": 1 },
  "message": {
    "parts": [{
      "kind": "artifact",
      "source": {
        "kind": "step_artifact",
        "stepId": "capture_decision",
        "artifact": "captured_json"
      }
    }]
  },
  "delivery": "direct",
  "ending": "cr"
}
```

若提交值是`{"decision":"retry","confidence":0.82}`，该textual consumer得到稳定单行`{"confidence":0.82,"decision":"retry"}`；artifact map与`.json` evidence仍保存typed/pretty形式。

反例：把Room A的generation/terminal/launch body发到Room B path必须返回runtime membership mismatch；在Capture开始前提交必须返回not-waiting；`{"decision":"other"}`必须返回schema mismatch并继续等待。

最小artifact evidence：

```json
{
  "kind": "artifact_created",
  "data": {
    "stepId": "capture_decision",
    "artifact": "captured_json",
    "captureKind": "structured-json",
    "terminalId": "term_...",
    "launchId": "launch_..."
  }
}
```

## 测试

阻断验收必须覆盖：

* Macro persistable/runnable validator接受合法schema、合法`$ref` property/data名称与重复`$id`独立编译，接受JSON artifact进入全部正式textual consumer，拒绝真正subschema位置的remote reference、invalid schema、Parallel structured kind、text artifact进入`json_match`、JSON artifact进入Parallel Output和invalid JSON Pointer。
* JSON matcher覆盖root/nested/escaped key/array index、missing、strict scalar type和number comparator；JSON textual projection覆盖object key排序、nested value、array/scalar、无缩进和无末尾换行。
* CLI覆盖缺context、invalid stdin、server validation issue与成功提交。
* HTTP/runner integration覆盖token优先、malformed body优先于malformed path、malformed path归一membership mismatch、canonical justfile env、正确Room成功、错误/已销毁Room membership拒绝、无waiter拒绝、schema mismatch后重试成功、Pause/Resume、Stop、timeout和一次消费。
* Visual/JSON editor覆盖structured kind、parse-valid invalid schema raw保留、schema编辑、waitLimit，以及Send/Notify/Input default/Extract Text/`text_match`和`json_match`各自正确的`captured_json` choice。
* 现有AgentEvent Capture、text match、artifact evidence、Room隔离和完整current UI journey保持通过。

正式验证按顺序执行task focused recipe、`just check`、`just build`、`just test-unit`、`just test-e2e`与`just diff-check`；所有warning/error都阻断干净Close Gate。
