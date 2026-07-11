# Contract

## 任务边界

本任务只处理 Macro template current schema 与直接控制 Macro runner 的 HTTP request contract。目标不是设计新功能，而是删除同一语义的旧写法、忽略字段和 fallback，使 type、validator、store、HTTP、runner、editor、tests 与 current docs 只有一个真值。

以下任一情况阻断交付：

* 缺少 `range.kind` 的 count loop 仍能通过 type、save、read、import、HTTP PUT/import 或 runner start。
* Runner 或 editor 仍把 missing kind/default count 当成有效输入。
* TerminalRef extra own field 仍能通过并被持久化。
* Runner action request 仍接受 `nextStepId`、mock fields 或任意 unknown field。
* Production 中仍保留专门识别旧 macro type/field/mode 的 compatibility/legacy branch。
* Current docs、普通 fixture 或示例仍把退出的写法描述成可用。

## 任务规范

### 唯一 ForRange contract

~~~ts
type FlowV2ForRange =
  | { kind: "count"; count: number }
  | { kind: "forever" }
  | { kind: "text-list"; items: TextListItem[] }
~~~

三个 variant 都必须显式存储 discriminator：

* count 只允许 `kind`、`count`，且 count 是正整数。
* forever 只允许 `kind`。
* text-list 继续只允许 `kind`、`items`，item contract 沿用 `.026`。
* 缺少、未知或额外 discriminator/field 都失败。
* 不增加 schemaVersion；同一 `schemaVersion: 2` 下直接执行 hard cut。

### Exact TerminalRef contract

~~~ts
type TerminalRef =
  | { kind: "index"; value: positiveInt }
  | { kind: "id"; value: TerminalId }
  | { kind: "alias"; value: PublicId }
~~~

Macro JSON 中的 TerminalRef object 必须恰好拥有 `kind`、`value` 两个 own enumerable JSON field。该规则覆盖 send/input/wait terminal、capture terminal、parallel lane terminal 及任何复用 `validateTerminalTarget` 的 Macro surface。

Index/id/alias 是三种当前目标语义，不是 compatibility alias。Scalar string/number terminal ref 继续只属于 terminal manager 内部 API，不得进入 Macro JSON。

### Current allowlist validator

Validator 只维护当前 template keys、current node type sets 和每种 current object 的 exact keys：

* Unknown node type 统一报 unsupported current Flow V2 type。
* Unknown field 统一报 extra current Flow V2 field。
* Unknown wait/capture/matcher mode 按当前 union 报 unsupported value。
* 不维护 removed type set、legacy field set、旧 parser kind 或旧 wait mode的专用递归扫描。
* Session/Codex identity rejection 继续保留；它是当前产品安全边界，不是旧语法 reader。
* Literal user text 中出现旧单词或双花括号继续按该字段的 current literal semantics 保存，不参与结构扫描。

### Store 与 import

Read、list、duplicate、export、save、PUT、import 和 runner start 都必须经过同一个 current validator，且不能 normalize nested syntax。

Import 仍可在输入完整通过 current schema 后执行以下当前 import 语义：

* 将 template 归属改为目标 configId。
* id 冲突时生成新 template id。
* updatedAt 写为导入时间，保留有效 createdAt。

因为 current validator 已要求 id/createdAt 存在且合法，import 实现不得再保留“缺字段时自动生成”的不可达 fallback。

### Runner 与 editor

Runner 对 `node.range.kind` 做 exhaustive branch：

* count 使用 `range.count`。
* forever 使用 infinity。
* text-list 使用 item length 和 binding。
* 不存在 `?? "count"`、missing count default 或 `"count" in range` fallback。

Macro editor 只生成显式 discriminator。Mode/read helper 也必须 exhaustive；不能把未知或缺失 kind 静默显示为 count。

### Runner action HTTP contract

| Action | 唯一合法 JSON body |
| --- | --- |
| start | `{ "templateId": string }` |
| pause | `{}` |
| resume | `{}` |
| stop | `{}` |
| input | `{ "text": string }` |

规则：

* Request body 必须是合法 JSON object；malformed JSON、array、null 或 scalar 返回 HTTP 422，error 为 `runner_request_invalid_field:<action>:body`。
* Zero-byte empty body 按 `{}` 处理，因此只对 pause/resume/stop 合法；whitespace-only body 不是合法 JSON，返回 invalid body 422。
* Required field 缺失或类型错误、任意 unknown field均在 service dispatch 前返回 HTTP 422。
* Exact-key parser 先检查 unknown own field，再检查 required field；每个等价类只返回一个确定错误。
* Error body 保持 `{ "ok": false, "error": string }`；稳定格式为 `runner_request_missing_field:<action>:<field>`、`runner_request_invalid_field:<action>:<field>`、`runner_request_unknown_field:<action>:<field>`。
* Runtime state conflict、live-run conflict 或 service failure 继续返回 HTTP 409。
* Client `resume()` 不接收参数。
* `StartMacroRunRequest` 只含 templateId；runtime state 不存 mock fields。
* Start 的 `templateId` 必须是 non-empty string；空字符串是 invalid field，不 dispatch。
* Input 的 `text` 只要求是 string，可以为空；是否接受空内容继续由当前 waiting input 的 `allowEmpty` 在 service 层决定。

### 错误与数据语义

* 旧 template file/read/list 失败使用现有 `invalid_macro_template` 包装。
* Template validate/PUT 返回结构化 validation issues；缺 kind 和 extra terminal field 必须带准确 path。
* 旧 runner request 不允许静默忽略，也不允许先 dispatch 后再给 runtime error。
* 所有 rejection 都不修改输入、磁盘 template、run state 或 cursor。

## 示例

### 合法 Macro

~~~json
{
  "id": "loop_three",
  "type": "for",
  "range": { "kind": "count", "count": 3 },
  "body": [
    { "id": "finish_loop", "type": "finish" }
  ]
}
~~~

~~~json
{
  "id": "send_worker",
  "type": "send",
  "terminal": { "kind": "alias", "value": "worker" },
  "message": { "parts": [] },
  "enter": true
}
~~~

### 非法 Macro

缺少 discriminator：

~~~json
{ "id": "loop_old", "type": "for", "range": { "count": 3 }, "body": [{ "id": "wait_old", "type": "wait", "mode": "duration", "durationMs": 1 }] }
~~~

TerminalRef 夹带字段：

~~~json
{
  "kind": "alias",
  "value": "worker",
  "terminalId": "term_old"
}
~~~

两者都必须在 validator/store/import/start 入口失败，不得变成 warning 或被重写。

### Runner request 正反例

~~~json
POST /api/configs/<configId>/runner/resume
{}
~~~

合法。

~~~json
POST /api/configs/<configId>/runner/resume
{ "nextStepId": "send_2" }
~~~

返回 HTTP 422，不能改变或覆盖 cursor。

~~~json
POST /api/configs/<configId>/runner/start
{ "templateId": "tmpl_current", "mockCaptureReady": true }
~~~

返回 HTTP 422。

## 测试与 Close Gate

### Contract tests

* Type/fixture 全部使用 explicit count kind；至少保留一个 `as never` negative case证明 missing kind fails。
* Editor E2E 证明新建/切换 count 后 JSON preview、save 与 reload 始终包含 `kind:"count"`；invalid import 在进入 editor 前失败，因此 editor 没有 missing-kind 显示入口。
* Validator 覆盖 count 正例、missing kind、unknown kind、extra range field。
* TerminalRef 对 index/id/alias 各有正例，并对 extra own field、scalar string/number 有反例。
* Literal text 中旧词继续保真，证明删除 structural legacy scanner 不影响用户内容。
* Store save/import/read 对 missing kind 和 extra TerminalRef 均 fail loudly，且不创建/重写目标文件；missing id/createdAt 继续失败，证明 import 无自动填充。
* 磁盘 invalid template 的 list、duplicate、export 复用 read validator；测试至少覆盖 list 与 duplicate，并用 HTTP export 证明公开导出入口没有旁路。

### Runtime/API tests

* Count/forever/text-list runner regression 保持通过。
* Runner start 分别对磁盘旧 count 和 extra TerminalRef template fail，且不创建 run、不改变 runner snapshot。
* HTTP 对五个 action 的 canonical body正例或可 dispatch 证明，以及 missing/wrong/unknown field 等价类。
* Template HTTP PUT/import 分别覆盖旧 count 与 extra TerminalRef：返回 422、包含准确 issue path/error path，并证明没有创建或覆盖文件、list 不变。
* `resume.nextStepId`、start mock fields 必须 422；空 input text通过 request syntax并交给 `allowEmpty`；service/client type 层不再暴露退出参数。
* Malformed JSON、array/null、empty templateId 和 unknown+missing priority按冻结格式返回 422。
* Runtime conflict 仍为 409，证明 syntax failure 与 state failure 没有混淆。

### Close Gate

* 新增 `just test-027` / `test:027`。
* 串行执行 `just check`、`just test-027`、`just test-unit`。
* `git diff --check`。
* Legacy Kill List 最终扫描无 production count fallback、runner ignored args、mock fields、legacy type/field scanner。
* Current active spec、quickstart、task index 与源码一致。
* AI post-review 无未解决 P1/P2；P3 只能作为明确非阻断残余风险。
