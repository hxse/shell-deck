# Contract

## 任务边界

本任务交付 Macro terminal input 的第二个正交维度：`delivery` 决定正文如何进入目标tab，`ending` 继续只决定正文之后追加哪些原始控制字节。完成后，新节点默认 Auto：Shell target解析为Bracketed paste，Text target解析为Direct bytes；用户仍可显式强制Direct或Bracketed paste。

范围内：

* `send`、`input` 和 parallel lane `send` 增加 required `delivery: "auto" | "direct" | "bracketed-paste"`。
* Auto在实际写入时按current target capability解析：Shell -> bracketed-paste，Text -> direct；显式模式不受target影响。
* Direct 精确写 `content + ending`。
* Bracketed paste 精确写 `ESC[200~ + content + ESC[201~ + ending`，ending 必须位于 end marker 之外。
* 三个 editor surface 使用相同的三项Input delivery select与Auto tooltip；新节点显式默认auto。
* Current `terminal_text_sent` evidence同时记录requested `delivery`与actual `resolvedDelivery`；write artifact保存完整wire payload。
* Resolved Bracketed paste content与end marker冲突时，在任何terminal write前拒绝，并按本节冻结的send/input/parallel状态处理。
* Store、HTTP、runner、tests、Current Docs和本机真实Shell/Text/Codex smoke全部切到current contract。

范围外：

* 不识别 Codex 进程、terminal alias、process title或 TUI brand。
* 不注入 `disable_paste_burst`，不替第三方程序修改配置。
* 不增加 fixed delay、paced typing、content/ending 两阶段 write或新的 phase cursor。
* Auto不解析/追踪 `CSI ? 2004 h/l`，不识别foreground process，不根据正文猜测，也不做runtime fallback。
* Ending保持 `none | lf | cr | crlf`，不增加Ending Auto。
* 不增加 keyboard-event、special-key或通用 escape-sequence DSL。
* 不重写历史append-only run events或已有explicit Direct/Bracketed paste template。

破坏性边界：

* 旧 template缺少 delivery时，save/import/read/list/duplicate/export、HTTP和runner start全部 fail loudly。
* 不提供 optional field、missing default、migration、alias、dual reader或自动转换。
* `schemaVersion: 2` 直接执行hard cut；只有editor创建新节点时显式写 `delivery: "auto"`。
* 已有explicit `direct` / `bracketed-paste`仍是current合法值，保持原值；不迁移、不rewrite。
* Production、Current Docs和普通positive fixtures必须删除missing delivery、unresolved-auto bypass、旧 `Enter / CR` 文案和current event缺requested/resolved evidence的写法。

停止线：

* Required schema、target resolver、exact framing、marker collision、三个action surface、event/artifact、editor persistence、real Shell/Text、真实Codex local-command smoke和Current Docs全部通过正式Gate后结束。
* DEC mode自动探测、Ending Auto、通用key DSL和前台程序识别只可作为后续独立任务，不进入本轮。
* 本任务范围内P1/P2必须清零；范围外风险和既有Vite bundle advisory可在review记录为非阻断项。

## 任务规范

### Added Semantics

新增唯一公开类型：

```ts
type TerminalInputDelivery =
  | "auto"
  | "direct"
  | "bracketed-paste"

type ResolvedTerminalInputDelivery =
  | "direct"
  | "bracketed-paste"
```

Send/Input current shape：

```ts
type SendNode = {
  id: string
  type: "send"
  terminal: TerminalTarget
  message: MessageSpec
  delivery: TerminalInputDelivery
  ending: TerminalEnding
}

type InputNode = {
  id: string
  type: "input"
  terminal: TerminalTarget
  prompt: TemplatableScalarText
  allowEmpty: boolean
  delivery: TerminalInputDelivery
  ending: TerminalEnding
  defaultSource?: FlowV2ArtifactSource
}
```

`delivery` 必须是own enumerable required field，只接受exact lowercase `auto`、`direct`或`bracketed-paste`。Missing、undefined、boolean、大小写变体、`raw`、`paste`、inherited和non-enumerable值全部失败。Parallel lane send继续复用 `SendNode`，不得维护第二套schema或runtime mapping。

### Target-aware resolution

Runner必须先把TerminalTarget解析为stable terminal id，再在每次实际write前读取同一terminal的current snapshot capability，并通过唯一exhaustive resolver得到actual mode：

```text
requested auto + capability shell -> resolved bracketed-paste
requested auto + capability text  -> resolved direct
requested direct                  -> resolved direct
requested bracketed-paste         -> resolved bracketed-paste
```

Resolution输入是已经存在的`TabCapabilityKind = "shell" | "text"`，不是alias名称、backend字符串、前台进程或正文。Shell capability包括real shell和测试/开发shell backend；Text capability只指plain Text tab。未来出现未知capability必须fail loudly，不得默认为任一mode。

Resolution发生在shared write path：

* Normal send在发送时解析。
* Runtime input在用户submit时重新读取current snapshot；不得在`user_input_requested`时缓存，因为等待期间terminal可能reset或改变backend。
* Parallel send复用同一shared path。

显式Direct/Bracketed paste不因target改变。Auto不得改写template、不得把resolved值持久化回delivery，也不得维护第二份editor auto/manual provenance。

### Frozen Semantics

`ending` 保持 `none | lf | cr | crlf`：

```text
none -> ""
lf   -> "\n"
cr   -> "\r"
crlf -> "\r\n"
```

`content` 仍是完成message parts、scoped template、artifact或用户输入解析后的最终字符串。Resolution只选择正文framing，不修改content或ending。Terminal manager、real backend和PTY helper继续只负责有序字节转发，不理解requested delivery。

### Editor contract

三个surface都显示：

```text
Input delivery: [Auto (recommended) | Direct bytes | Bracketed paste]
Ending sequence: [None | CR (\r) | LF (\n) | CRLF (\r\n)]
```

新send、input、parallel send都显式生成：

```json
{
  "delivery": "auto",
  "ending": "cr"
}
```

Delivery options由一个共享Svelte组件维护；Input delivery标签旁提供同一focusable Auto help affordance，hover或keyboard focus时显示真实`role="tooltip"`内容：`Auto uses Bracketed paste for Shell tabs and Direct bytes for Text tabs. Direct bytes and Bracketed paste force the selected mode.` 不得只把`title`挂在native`option`上。Input delivery的label与select必须继承Macro表单统一typography，computed font family/size/weight与相邻Ending sequence一致；除help与tooltip外不得维护component-specific field字号或字重。Ending继续由共享组件维护，且不增加Auto。`Enter / CR`文案退出，因为raw CR不是通用keyboard event。

Normal Send、Input与parallel Send切换Shell/Text target（包括lane target propagation）时，`delivery:"auto"`都保持auto并在runtime按新target解析；显式Direct/Bracketed paste在切换前后都保持原值。Preview、save、reload、duplicate和export只持久化requested选择，不写入resolved值。

### Wire contract

唯一framing常量：

```ts
const BRACKETED_PASTE_BEGIN = "\u001b[200~"
const BRACKETED_PASTE_END = "\u001b[201~"
```

唯一payload映射：

```text
resolvedDelivery=direct:
  content + suffix(ending)

resolvedDelivery=bracketed-paste:
  BRACKETED_PASTE_BEGIN
  + content
  + BRACKETED_PASTE_END
  + suffix(ending)
```

Builder只接受`ResolvedTerminalInputDelivery`，不得接收`auto`并隐式走非Direct分支。Runner先resolve actual mode、构造完整logical payload，再调用一次 `manager.input(..., payload)`。不得在content与ending之间sleep、await或开放其他terminal input插入。Real backend可以继续把长payload按4096 bytes拆成有序transport frames；本contract不声称一次OS `write(2)`，只要求一次runner side effect和不间断的有序input stream。

Send、runtime input和parallel send必须共享同一个resolver与payload builder。Resolved direct不解释正文中的bracket markers，继续原样写入。

### End marker collision

当 `resolvedDelivery="bracketed-paste"` 且最终resolved content包含exact `BRACKETED_PASTE_END` 时，payload builder返回：

```text
bracketed_paste_end_marker_in_content
```

检查发生在完整content拼接后，因此跨message parts形成的marker也必须被发现。不得escape、删除、truncate、拆分marker或静默回退direct。

Auto + Shell会解析为bracketed-paste，因此发生相同zero-write拒绝；Auto + Text解析为direct，exact marker按Direct语义原样允许。显式Text + Bracketed paste仍检查collision并保留marker framing，这是manual override的预期行为。

三种surface的共同证据边界：

* 不调用terminal manager/backend。
* 不生成terminal content artifact、terminal write artifact或 `terminal_text_sent`。
* 当前invocation保持started但不complete；不生成 `step_completed`。
* 已经发生的 `step_started`、terminal-ref或input lifecycle evidence可以保留，它们不代表terminal write成功。

状态和resume语义：

| Surface | Collision后的状态 | Resume / retry |
| --- | --- | --- |
| 普通send | 走现有step exception路径，run `paused`；message含 `terminal_input_rejected:bracketed_paste_end_marker_in_content` | resume重入同一send；若resolved content不变，再次zero-write暂停。用户应stop、编辑template并启动新run |
| runtime input | 保留已发生的 `user_input_submitted` artifact/event，随后以 `terminal_input_rejected` 暂停 | resume回到同一input invocation并重新等待用户输入；绝不自动重放旧unsafe text |
| parallel send | lane抛出相同underlying reason且zero-write | parent `onLaneFail:"fail"` 进入failed；`onLaneFail:"pause"` 进入paused。Pause后resume重入同一lane action，内容不变则再次按policy失败 |

Failed run不可resume；paused run保留现有occurrence-aware cursor。本任务不增加collision专用cursor。

### Run-event evidence

Current producer必须写：

```json
{
  "kind": "terminal_text_sent",
  "stepId": "send_prompt",
  "data": {
    "terminalId": "term_worker",
    "delivery": "auto",
    "resolvedDelivery": "bracketed-paste",
    "ending": "cr",
    "content": {
      "artifactRef": "artifacts/send-content-...",
      "chars": 5
    },
    "write": {
      "artifactRef": "artifacts/send-write-...",
      "chars": 18
    }
  }
}
```

`delivery`保存template requested值，`resolvedDelivery`保存actual framing值；显式Direct/Bracketed paste也必须同时写两者且值相同。`content` artifact保存未加framing/ending的resolved正文；`write` artifact保存actual framing、正文和ending组成的完整payload。Current event不增加`inputMode`、`dispatchMode`、`paste` boolean或target program字段。

历史append-only event按通用replay保留，既不补delivery，也不增加legacy branch。

### Public entry points

Template save/import/read/list/duplicate/export、HTTP PUT/import/export、runner start和editor JSON preview/import都共享current validator。缺少或非法delivery必须在进入runtime之前失败；失败不创建、不覆盖、不rewrite、不启动run。

## 示例

### Auto Shell 与 Text

```json
{
  "schemaVersion": 2,
  "id": "tmpl_auto_delivery",
  "name": "Auto delivery",
  "description": "",
  "configId": "local",
  "body": [
    {
      "id": "send_shell",
      "type": "send",
      "terminal": {
        "kind": "alias",
        "value": "shell_1"
      },
      "message": {
        "parts": [
          {
            "kind": "text",
            "text": "printf auto-shell"
          }
        ]
      },
      "delivery": "auto",
      "ending": "cr"
    },
    {
      "id": "send_text",
      "type": "send",
      "terminal": {
        "kind": "alias",
        "value": "text_1"
      },
      "message": {
        "parts": [
          {
            "kind": "text",
            "text": "plain text"
          }
        ]
      },
      "delivery": "auto",
      "ending": "cr"
    }
  ],
  "createdAt": "2026-07-12T00:00:00.000Z",
  "updatedAt": "2026-07-12T00:00:00.000Z"
}
```

`send_shell`保存requested auto并解析为bracketed-paste；`send_text`保存requested auto并解析为direct，Text panel不得出现`200~` / `201~`残片。两者的ending都保持CR。

### 普通shell：direct + CR

```json
{
  "schemaVersion": 2,
  "id": "tmpl_direct_shell",
  "name": "Direct shell command",
  "description": "",
  "configId": "local",
  "body": [
    {
      "id": "send_shell",
      "type": "send",
      "terminal": {
        "kind": "alias",
        "value": "shell_1"
      },
      "message": {
        "parts": [
          {
            "kind": "text",
            "text": "printf 'done\\n'"
          }
        ]
      },
      "delivery": "direct",
      "ending": "cr"
    }
  ],
  "createdAt": "2026-07-12T00:00:00.000Z",
  "updatedAt": "2026-07-12T00:00:00.000Z"
}
```

Wire payload是：

```text
printf 'done\n' + CR
```

### Codex/TUI：bracketed paste + CR

```json
{
  "schemaVersion": 2,
  "id": "tmpl_bracketed_codex",
  "name": "Bracketed Codex prompt",
  "description": "",
  "configId": "local",
  "body": [
    {
      "id": "send_prompt",
      "type": "send",
      "terminal": {
        "kind": "alias",
        "value": "codex_1"
      },
      "message": {
        "parts": [
          {
            "kind": "text",
            "text": "review this change"
          }
        ]
      },
      "delivery": "bracketed-paste",
      "ending": "cr"
    },
    {
      "id": "ask_followup",
      "type": "input",
      "terminal": {
        "kind": "alias",
        "value": "codex_1"
      },
      "prompt": "Follow-up prompt",
      "allowEmpty": false,
      "delivery": "bracketed-paste",
      "ending": "cr"
    }
  ],
  "createdAt": "2026-07-12T00:00:00.000Z",
  "updatedAt": "2026-07-12T00:00:00.000Z"
}
```

`send_prompt` 的wire payload是：

```text
ESC[200~review this changeESC[201~CR
```

### 关键反例：缺少delivery

下面的旧shape无效，不会被解释成auto：

```json
{
  "id": "old_send",
  "type": "send",
  "terminal": {
    "kind": "alias",
    "value": "shell_1"
  },
  "message": {
    "parts": [
      {
        "kind": "text",
        "text": "echo old"
      }
    ]
  },
  "ending": "cr"
}
```

Validator必须报告 `delivery must be an own enumerable field`；store/HTTP/start不得迁移或补值。

### 关键失败例：跨parts形成end marker

```json
{
  "id": "unsafe_send",
  "type": "send",
  "terminal": {
    "kind": "alias",
    "value": "codex_1"
  },
  "message": {
    "parts": [
      {
        "kind": "text",
        "text": "safe\u001b[20"
      },
      {
        "kind": "text",
        "text": "1~tail"
      }
    ]
  },
  "delivery": "bracketed-paste",
  "ending": "cr"
}
```

Parts拼接后包含exact `ESC[201~`，因此terminal zero-write并进入本节冻结的send pause路径。同样正文若使用 `delivery:"direct"` 则原样允许。

## 测试

自动化和formal smoke至少覆盖：

* Schema/type：send、input、parallel send接受三个delivery正例；missing、undefined、boolean、wrong-case（包括`Auto`）、`raw`、`paste`、inherited、non-enumerable和unknown alias全部失败。
* Resolver unit：Auto × Shell/Text与两个explicit mode × Shell/Text逐值exact；未知requested值或capability fail loudly，builder拒绝unresolved Auto。
* Store/HTTP/start：missing或invalid delivery在save/import/read/list/duplicate/export/PUT/start fail loudly，且不创建、不覆盖、不rewrite、不创建run。
* Exact wire oracle：resolved direct/bracketed-paste × none/LF/CR/CRLF共8个payload逐字节一致；Auto Shell/Text分别命中对应wire；ending始终在end marker外；每个action只有一次backend write调用。
* Shared runtime：普通send、runtime input和parallel send复用同一resolver/builder；event逐项覆盖auto/Shell -> auto + bracketed-paste、auto/Text -> auto + direct、explicit Direct -> direct + direct、explicit Bracketed paste -> bracketed-paste + bracketed-paste，并记录ending；content/write artifacts分别是裸正文和完整wire。
* Collision：static、跨parts、template/artifact和runtime input的最终content检查；Auto Shell走bracketed zero-write拒绝，Auto Text与Direct marker原样允许；无terminal artifacts/success event、invocation未complete。
* Resume：普通send resume重复zero-write pause；runtime input resume后重新等待且不自动重发；parallel按onLaneFail分别failed/paused并保留underlying reason。
* Editor E2E：三个surface默认auto与CR，JSON preview显式包含`delivery:"auto"`/`ending:"cr"`；三项delivery、四项ending且没有Ending Auto；共享help在hover与keyboard focus后显示精确tooltip；Input delivery label/select的computed font family/size/weight与Ending sequence逐项一致。Normal Send、Input、parallel Send分别覆盖Shell↔Text切换仍保持auto，explicit Direct/Bracketed paste在target/lane propagation后及preview/save/reload/duplicate/export仍保持原值；不再出现`Enter / CR`。
* Real Bash/readline：Auto + CR解析为bracketed-paste并提交命令；explicit Direct/Bracketed paste继续通过wire回归。
* Text panel：Auto send与runtime input解析为direct，不显示`200~` / `201~` marker残片；Auto Text正文含exact end marker仍按direct原样允许；explicit Bracketed paste保持manual override。
* Real Codex TUI：独立`just test-029-codex-tui`记录`codex --version`，显式`disable_paste_burst=false`，通过Macro Auto发送`/quit` + CR；event断言requested auto / resolved bracketed-paste，超时内必须观察`Shutting down...`并回到Bash prompt。使用隔离`CODEX_HOME`、假API key和拒绝连接的loopback base URL，禁止模型请求。

正式Gate命令：

```text
just check
just test-029
just test-029-codex-tui
just test-unit
git diff --check
```

`test-029-codex-tui` 在本机Codex不可用时必须明确BLOCKED/FAIL，不能以SKIP满足本任务formal Gate。Default offline tests不依赖Codex binary、网络、认证或模型quota。
