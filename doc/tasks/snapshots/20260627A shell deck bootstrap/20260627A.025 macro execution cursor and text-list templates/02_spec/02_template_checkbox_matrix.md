# Template Checkbox Matrix

## 规范地位

本文件冻结 Macro editor 中 `Use {{text}} template` checkbox 的唯一名单。实现不得用“字段是 string”“控件是 input/textarea”或“节点位于 for 内”自动推导 template capability；只能给下表明确列出的内容字段开放 checkbox。

一个字段同时满足以下两项时，用户才能从 literal 主动开启 template：

1. 字段在“支持名单”中。
2. 字段位于至少一个 enclosing `text-list for` 的 lexical scope 内。

`if/elif/else`、control-terminal action-only body、内层 count/forever 和 parallel lane body 只负责继承 scope，不会让其它 text 字段自动获得 capability。内层 text-list 使用最近一层 binding。

## Checkbox 状态规则

| 字段能力 | 当前 scope | 当前底层值 | UI contract |
| --- | --- | --- | --- |
| 支持名单 | 有效 | literal | 显示 checkbox，默认未勾选，允许开启 |
| 支持名单 | 有效 | template | 显示 checkbox且已勾选，允许关闭；显示 binding 来源和 `Insert {{text}}` |
| 支持名单 | 无效 | literal | 不显示开启入口 |
| 支持名单 | 无效 | template | 保留已勾选状态和正文，显示 inline scope error；只允许取消勾选修复，不显示 Insert 按钮 |
| 不支持名单 | 任意 | 合法原字段值 | 永不显示 checkbox |
| 不支持名单 | 任意 | 错误塞入 template object/part | Schema validation fail；不得由 UI 或 runner 猜测、迁移或展开 |

Message text part 的 checkbox 只控制当前 part：

```json
{ "kind": "text", "text": "处理：{{text}}" }
```

勾选后无损转换为：

```json
{ "kind": "template", "template": "处理：{{text}}" }
```

Scalar content field 的 literal 是原有 string，勾选后转换为：

```json
{ "kind": "template", "template": "处理：{{text}}" }
```

关闭 checkbox 时必须把原正文无损转回 literal；开启或关闭都不得 trim、插入 token 或改写换行。

## 支持名单

以下六类是本任务唯一支持 template checkbox 的 text box：

| 编号 | Editor text box / JSON path | 条件与说明 |
| --- | --- | --- |
| S1 | 普通 `send` 的 `message.parts[].text` textarea | 每个 text part 独立 checkbox；artifact part 没有 checkbox |
| S2 | `parallel.lanes[].body[]` 中 `send.message.parts[].text` textarea | 只有整个 parallel 位于有效 text-list scope 时开放；lane 继承当前 binding |
| S3 | `notify.title` input | Scalar template；notify 仍不允许进入 parallel lane |
| S4 | `notify.message.parts[].text` textarea | 每个 text part 独立 checkbox；artifact part 没有 checkbox |
| S5 | `input.prompt` input | 只模板化运行前显示的 prompt；用户运行时提交的 textarea 内容不模板化 |
| S6 | `wait` 且 `mode = "user-continue"` 时的 `prompt` input | duration/terminal-quiet 没有此能力；user-continue 仍不允许进入 parallel lane |

S1、S3、S4、S5、S6 可以直接位于 text-list body，也可以位于其 descendant if branch、control-terminal action-only body 或内层 count/forever body。S2 只是在 parallel lane 当前允许 action 集合内复用 S1，不扩大 lane action language。

## 不支持名单

以下是当前 Macro/Flow editor 中所有其余 user-editable text/string surface；即使它们位于 text-list for 内，也永不显示 template checkbox：

| 类别 | 明确不支持的 text box / 字段 | 原因与现有语义 |
| --- | --- | --- |
| Template editor metadata | template `name` input、`description` textarea | 模板说明，不是每轮 runtime content |
| Template JSON identity | template `id`、`configId` | 即使通过 JSON 导入/编辑也属于 identity/scope，不是 content；当前表单不提供 template checkbox |
| Node identity | 所有 node `id`、parallel lane `id`、output `id` | Identifier Contract；运行前静态且全局可追踪 |
| For source | `for.range.items[]` 的每个 item textarea | Item 是 binding source，不是 template consumer；原样保存且不递归展开 |
| Send/notify source | `message.parts[kind=artifact].source` 以及 Source artifact selector | 结构化引用；artifact 内容也不做二次展开 |
| Input runtime data | Macro Run 中等待用户输入的 textarea、`input.defaultSource` | 用户数据/artifact prefill，不是 template 配置；提交内容原样发送 |
| Notify config | `level`、channel、sound、Telegram `profileId` 等 channel controls | 枚举、selector 或本机配置引用，不是正文 |
| Wait config | duration、terminal-quiet 的 target/数值/onTimeout | 结构化 wait 参数；只有 user-continue prompt 属于支持名单 |
| Capture source | terminal selector、capture kind/mode、agent kind、captureMode、maxChars | 结构化 source 配置；capture result 是 runtime artifact |
| If condition | `condition.matcher.text`、regex `pattern`、`flags` | 控制流匹配规则；`{{text}}` 不得把静态 condition 升级成动态表达式 |
| Extract split | `extract_text.split.pattern`、`flags` | Regex grammar，不是内容模板 |
| Extract filters | `filters[].matcher.text`、regex `pattern`、`flags` | 静态解析规则，不是内容模板 |
| Extract result regex | `extract.pattern`、`flags`、string/named `group` | 静态解析规则，不是内容模板 |
| Parallel metadata | `lanes[].label`、lane/output/action ids | UI label 或 identity；每轮不得动态变化 |
| Parallel merge | `parallel.merge.separator` | 只保留现有 `{laneId}`、`{laneLabel}`、`{terminalAlias}` 单花括号 grammar；不支持 `{{text}}` |
| Control metadata | `break.reason`、`continue.reason`、`finish.reason` | Trace/control metadata，不是发送或提示内容 |
| Selectors/references | terminal alias/id、artifact stepId/name、notification profile id | 结构化 identity/reference，不能被 runtime 字符串替换 |
| Workbench chrome | 搜索框、过滤框、selector search、JSON preview/editor controls、Prompt Library 字段 | 不属于 Flow node 的 scoped runtime content；本任务不扩展到 Macro editor 外围功能 |

在不支持名单的普通 string 中输入 `{{text}}` 不会触发 template validation 或 expansion：metadata/simple matcher/reason 等按原字符串处理；regex 字段按 regex grammar 校验；parallel separator 只按它现有的单花括号 grammar 处理。错误地把 `{ "kind": "template" }` object 放进这些字段则按类型/schema 错误拒绝。

## 实现与测试约束

* UI 和 validator 必须维护同一份显式 capability whitelist，不能各自用宽泛的 `typeof value === "string"` 或 loopDepth 判断。
* Shared message parts editor 必须同时服务普通 send、notify 和 parallel lane send，确保 S1/S2/S4 的 checkbox 行为一致。
* Shared scalar template field 必须同时服务 S3/S5/S6，确保 string/template 转换和 out-of-scope error 行为一致。
* Unit/schema tests 必须逐项覆盖 S1-S6，并逐组证明不支持名单无法保存 template object/part。
* Editor E2E 必须逐项证明 S1-S6 在有效 scope 显示 checkbox、在无 scope 的 literal 状态不显示；还要覆盖 for items、condition matcher、extract regex/text、parallel label/separator 和 control reason 在有效 scope 仍无 checkbox。
* Node move E2E 必须证明 supported template 移出 scope 后保留内容并进入 error-only-off 状态，移回后恢复正常；unsupported field 永远不因移动获得 checkbox。
