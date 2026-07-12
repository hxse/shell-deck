# Contract

## 任务边界

本任务只定义 terminal-writing Macro action 在 rendered content 后追加什么输入序列。公开 JSON、编辑器、validator、runner 和 run evidence 必须使用唯一 `ending` contract；不增加 keypress 模拟层，不按 terminal 内运行的程序做特判。

以下任一情况阻断交付：

* `send`、`input` 或 parallel lane `send` 仍接受、生成或执行 `enter`。
* 缺少 `ending`、非法值或额外旧字段能通过 save/read/import/HTTP PUT/runner start。
* Runtime 对缺少/未知值偷偷使用 CR、LF 或 none fallback。
* 新建普通/parallel send 或 input 没有显式写入 `ending: "cr"`。
* 四种 ending 没有分别产生精确的 `""`、`"\n"`、`"\r"`、`"\r\n"`。
* Current event producer、demo、guide 或普通 fixture 仍使用 `enter` / `enterSequence`。
* 只通过 fake terminal 的回显推断字节，没有检查进入 backend 或 write artifact 的精确 payload。

停止线是完成上述 current contract、失败证明、Current Docs 同步和自动化 Gate。通用 special-key DSL、外部程序兼容矩阵、server restart hydration 和历史 event 重写不进入本任务。

## 任务规范

### 唯一 Ending contract

~~~ts
type TerminalEnding = "none" | "lf" | "cr" | "crlf"

type SendNode = {
  id: string
  type: "send"
  terminal: TerminalTarget
  message: MessageSpec
  ending: TerminalEnding
}

type InputNode = {
  id: string
  type: "input"
  terminal: TerminalTarget
  prompt: TemplatableScalarText
  allowEmpty: boolean
  defaultSource?: FlowV2ArtifactSource
  ending: TerminalEnding
}
~~~

`ending` 是 required own enumerable field，合法值与追加序列一一对应：

| `ending` | 追加字符串 | UTF-8/ASCII bytes | UI 含义 |
| --- | --- | --- | --- |
| `none` | `""` | 无 | 不追加 |
| `lf` | `"\n"` | `0A` | LF |
| `cr` | `"\r"` | `0D` | Enter / CR；新建默认 |
| `crlf` | `"\r\n"` | `0D 0A` | CRLF 两字节 |

Runtime payload 唯一公式为：

~~~ts
write = content + sequenceFor(ending)
~~~

`content` 是 message render 或 runtime user input 的原始结果，不 trim、不 normalize、不 template-expand runtime input。Ending 只在 terminal write boundary 追加，不写回 template message、runtime textarea 或 content artifact。

### Editor contract

普通 `send`、`input` 和 parallel lane `send` 都显示一个 `Ending sequence` select：

* `None`
* `Enter / CR (\\r)`
* `LF (\\n)`
* `CRLF (\\r\\n)`

移除 `Submit with Enter` checkbox。所有新建节点显式存储 `cr`，save/reload/JSON preview 保持用户选择。没有隐藏 checkbox、按 backend 自动改值或 Codex-specific option。

### Validation 与持久化

* Send/Input object allowlist 用 `ending` 替换 `enter`。
* 缺失、inherited、non-enumerable、非字符串或非法 ending 在准确 node path 失败。
* 旧 `enter` 是 unknown field；若同时缺少 ending，可同时报告旧字段和 required ending issue，但不能解释旧值。
* Store save/read/list/duplicate/import/export、HTTP template PUT/import 和 runner start 继续复用同一 current validator。
* 不增加 schemaVersion、migration、normalizer、alias、warning-only period或 editor Convert。

### Runner 与 backend ownership

Runner 使用一个 exhaustive mapping 将 enum 转为字符串，随后调用现有 `TerminalDeckManager.input`。Manager、WebSocket、real PTY backend 和 helper 继续原样传输，不新增 keyboard-event abstraction。

Text backend 可以按其既有显示 contract 把 CR/CRLF normalize 为 LF；这不改变 runner 的 write artifact 和传入 backend 的 payload 必须准确。Fake backend 的 CR/LF 等价回显不能作为 ending oracle。

Parallel lane send 复用普通 `executeSend` / terminal-write 路径，因此必须获得完全相同的 mapping、event 和 failure semantics。

### Run-event evidence

新的 `terminal_text_sent.data` 记录：

~~~json
{
  "terminalId": "term_worker",
  "ending": "cr",
  "content": { "artifactRef": "...", "chars": 7 },
  "write": { "artifactRef": "...", "chars": 8 }
}
~~~

`content` artifact 保留追加前文本，`write` artifact 保留实际发送 payload，`ending` 解释两者差异。Current producer 不再写 `enter` 或 `enterSequence`。

旧 append-only event data 不被重写；run-event replay 本来按通用 data object读取，因此无需 legacy detection 或转换分支。Current demo/test event 必须只使用新 evidence。

## 示例

### 默认 Enter / CR

~~~json
{
  "id": "send_codex",
  "type": "send",
  "terminal": { "kind": "alias", "value": "worker" },
  "message": {
    "parts": [
      { "kind": "text", "text": "review the current change" }
    ]
  },
  "ending": "cr"
}
~~~

Runner 写入：

~~~text
review the current change\r
~~~

这里末尾是一个 CR 控制字节，不是文档换行，也不是 DOM keyboard event。

### 只写文本

~~~json
{
  "id": "input_draft",
  "type": "input",
  "terminal": { "kind": "id", "value": "term_worker" },
  "prompt": "Draft text",
  "allowEmpty": true,
  "ending": "none"
}
~~~

Runtime user input 原样写入，不追加任何字符。

### 显式 LF 与 CRLF

~~~json
{
  "id": "send_lf",
  "type": "send",
  "terminal": { "kind": "index", "value": 1 },
  "message": { "parts": [{ "kind": "text", "text": "line" }] },
  "ending": "lf"
}
~~~

写入 `line\n`。

~~~json
{
  "id": "send_crlf",
  "type": "send",
  "terminal": { "kind": "index", "value": 1 },
  "message": { "parts": [{ "kind": "text", "text": "line" }] },
  "ending": "crlf"
}
~~~

写入 `line\r\n` 两个结尾字节。

### 旧写法失败

~~~json
{
  "id": "send_old",
  "type": "send",
  "terminal": { "kind": "index", "value": 1 },
  "message": { "parts": [] },
  "enter": true
}
~~~

该节点同时含 unknown `enter` 且缺少 required `ending`，必须在 current validator/store/import/start 失败，不能自动转换成 CR 或 LF。

## 测试

### Schema 与公开入口

* Type 与所有正向 fixture只使用 required `ending`。
* Validator 覆盖四个合法值，以及 missing、unknown、wrong type、old enter、inherited/non-enumerable ending。
* Store/HTTP template入口证明旧 enter和 missing ending fail loudly，且不创建、不覆盖、不启动 run。
* Static check 证明生产代码和普通正向 fixture不能继续构造 `enter`。

### Runtime 与 evidence

* 使用 recording backend 或等价 raw oracle，参数化证明 none/LF/CR/CRLF 分别收到精确 payload。
* 分别验证普通 send、runtime input 和 parallel lane send走相同 mapping；至少一个测试直接覆盖每种 action surface。
* `terminal_text_sent` 只记录 `ending`，content/write artifacts准确保留追加前后数据与 chars。
* Real shell GUI/PTY regression 使用 CR 并正常提交；fake/text behavior只作为各 backend既有语义回归，不作为 raw sequence真值。

### Editor 与 Close Gate

* E2E 证明新建 send/input/parallel send 默认 CR，select可切换四值，save/reload/JSON preview准确。
* 旧 checkbox test id和文案退出 current UI。
* 新增 `just test-028` / `test:028` focused Gate。
* 串行执行 `just check`、`just test-028`、`just test-unit`；必要时执行受影响 E2E/real PTY focused suites。
* `git diff --check`、Legacy Kill最终扫描、Current Docs同步和 AI post-review均无未解决 P1/P2。
