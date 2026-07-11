# Failure And Scope Matrix

## 规范地位

本文件冻结旧输入在哪个最早边界失败，以及哪些看似“兼容”的现有能力不属于本任务。实现不能只让 runner 最终失败；能够在 type、validator 或 HTTP request parser 判定的问题必须在那里失败。

## Macro input failure matrix

| 输入 | Type/check | Validator | Store / HTTP template | Runner |
| --- | --- | --- | --- | --- |
| `range:{kind:"count",count:3}` | 接受 | 接受 | 接受 | 执行 3 轮 |
| `range:{count:3}` | 拒绝 | missing `range.kind` | fail loudly | 不启动 |
| unknown range kind | 拒绝 | unsupported kind | fail loudly | 不启动 |
| count extra field | 拒绝 | exact-key issue | fail loudly | 不启动 |
| TerminalRef exact `{kind,value}` | 接受 | 接受 | 接受 | 正常 resolve |
| TerminalRef scalar | 拒绝 | structured ref issue | fail loudly | 不启动 |
| TerminalRef extra field | 拒绝 | exact-key issue | fail loudly | 不启动 |
| old node type/field/mode | 拒绝 | current allowlist generic issue | fail loudly | 不启动 |
| old word/token inside literal text | 接受 | 按 literal current grammar | 原样保存 | 原样使用 |

Store/list 遇到磁盘中的 invalid template 继续整次 fail loudly，不 quarantine、不跳过。

## Public template entry proof

| 入口 | 必须证明的 hard-cut evidence |
| --- | --- |
| Validator | canonical 正例与 missing kind / extra TerminalRef 精确 path 反例 |
| Store save/read/import | fail loudly，且不创建、不覆盖、不 rewrite |
| Store list/duplicate | 磁盘 invalid file 通过共享 read validator 阻断 |
| HTTP template import/PUT | 422、准确 path、文件与 list 无副作用 |
| HTTP export | 磁盘 invalid file不能导出 |
| Runner start | 两类 invalid file 都不创建 run、不改变 snapshot |
| Editor | 新建/切换/save/reload count 始终显式 `kind:"count"`；invalid import 不进入 editor |

## Runner request failure matrix

| Request | HTTP | Service side effect |
| --- | ---: | --- |
| malformed JSON / array / null / scalar | 422 invalid body | 无 |
| whitespace-only body | 422 invalid body | 无 |
| zero-byte empty body on start/input | 422 missing field | 无 |
| zero-byte empty body on pause/resume/stop | dispatch；结果按 runtime 状态 | 允许 |
| start `{templateId}` | dispatch；结果按 runtime 状态 | 允许 |
| start 缺 templateId / 类型错误 | 422 | 无 |
| start 空 templateId | 422 invalid field | 无 |
| start 带 mock 或 unknown field | 422 | 无 |
| pause/resume/stop `{}` | dispatch；结果按 runtime 状态 | 允许 |
| pause/resume/stop 带任意 field | 422 | 无 |
| input `{text:string}` | dispatch；结果按 runtime 状态 | 允许 |
| input `{text:""}` | 通过 request parser | 由 waiting node `allowEmpty` 决定 |
| input 缺 text / 类型错误 / extra field | 422 | 无 |
| canonical request 但 runtime 状态冲突 | 409 | 由现有 service contract 决定 |

## Production Legacy Kill List

Close Gate 前必须删除：

* Type 中 `kind?: "count"`。
* Validator 中 `range.kind === undefined` count 分支。
* Runner 中 `range.kind ?? "count"` 和 invalid default total。
* Editor 中 missing kind -> count 的 fallback。
* Positive `legacyCount` fixture 与普通 `range:{count}` fixture。
* Active spec 中“reading `{count}` is allowed”。
* TerminalRef 对 unknown own fields 的静默接受。
* Runner client/service/HTTP 的 `nextStepId` request 参数。
* `mockCaptureText`、`mockCaptureReady` request/runtime dead fields。
* Runner action HTTP 对 unknown keys 的静默忽略。
* Production `FLOW_V2_FORBIDDEN_TYPES`、`LEGACY_FIELD_KEYS`、`rejectLegacyFields` 和旧 mode/parser 专用 branch。
* Import 对 missing id/createdAt 的不可达自动填充 fallback。

以下命中允许保留，但必须由路径和语义证明不是 compatibility：

* Negative tests 中的旧输入。
* 普通 literal text 中的旧词或 `{{text}}` 保真用例。
* 历史 task snapshots 中当时的 contract。
* Run-event schema/replay 的 legacy event compatibility。
* Event evidence 中的 `data.nextStepId`；它描述 server 计算的下一 invocation，不是 resume request 参数。
* Session/Codex identity rejection、current product exclusions。
* Terminal manager 内部 `normalizeTerminalRef(string|number)`。
* Parser profile compatibility check。

## 明确保持的 current variants

以下是不同当前语义，不是新旧 alias：

* TerminalRef 的 index/id/alias。
* Message literal/template/artifact parts。
* Artifact part no source 表示 none。
* Optional regex flags、range end、input defaultSource、if else、control reason/body。
* Count/forever/text-list 三个显式 ForRange variant。
* Target/Source/Lane tab 是 UI label；Macro JSON 字段仍唯一叫 `terminal`。

## 停止边界

本任务在 Macro current schema 和 runner request contract 达到上述矩阵、相关 current docs 同步、旧写法失败证据稳定且无未解决 P1/P2 后结束。不得继续扩张到 run-log 历史数据清理、字段命名重设计、cursor restart hydrate 或其它 API 的全仓 strictness。
