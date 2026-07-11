# Contract

## 任务边界

本任务在 schemaVersion: 2 内破坏性替换刚加入的 text-list 子协议。count、forever、其它 Flow V2 node、literal/template wrapper、executionPath 和 .025 的 continuation model 保持不变；旧 text-list string[] 与 {{text}} 不再是合法 schema。

以下问题阻断交付：

* validator、runner 或 editor 任一层仍接受、生成或解释旧 string item、{{text}}、entry-list、alias 或 mixed item。
* {{index}} 不是纯 1-based 十进制位置，或重排后与 run event iteration 不一致。
* key/value 被 trim、去重、拆行、递归插值，或被用于 occurrence identity。
* nested/parallel/pause-resume 使用错误 iteration binding。
* auto height 不按实际视觉内容变化、超过 auto cap 后不滚动，或用户拖大后下一次输入立即缩回。
* template capability 或 adaptive textarea surface 超出同目录矩阵。

## 公开类型与 strict schema

~~~ts
type TextListItem = {
  key: string
  value: string
}

type FlowV2ForRange =
  | { kind?: "count"; count: number }
  | { kind: "forever" }
  | { kind: "text-list"; items: TextListItem[] }

type TextListTemplateBinding = {
  index: number
  key: string
  value: string
  forStepId: string
}
~~~

text-list range 只允许 kind 和 items。items 必须是非空 array，每项必须是 object，且只允许 key、value 两个 own field：

* key 必须是 string，可以为空、重复、包含 Unicode 和首尾空白，但不得包含 CR 或 LF。
* value 必须是 string，可以为空、重复、包含 Unicode、CR/LF 和首尾空白。
* item 顺序保真；Add/Remove/Up/Down 只改变显式数组内容和顺序。
* index 不写入 item，不允许用户输入，也不接受 JSON index field。
* string[]、mixed string/object array、缺 key/value、unknown item field、entry-list、list/texts/values/as 等别名全部 validation fail。

新建 text-list 的默认 range 是：

~~~json
{
  "kind": "text-list",
  "items": [
    { "key": "", "value": "" }
  ]
}
~~~

不增加 schemaVersion，也不为旧子协议保留 parser。旧 template 在 read/list/import/store/start 遇到 string[] 或 {{text}} 时按现有 invalid_macro_template / preflight_failed 路径 fail loudly。

## Index contract

每轮 binding.index 等于 executionPath 最内层该 text-list segment 的 iterationIndex + 1：

* 第一项输出 1，第二项输出 2。
* 输出使用 String(index)，只含十进制数字；不带 #、Item、前后空格、补零或本地化数字。
* Up/Down 后 index 立即按新数组位置重算。
* key/value 与 item 一起移动；index 不属于持久化 item。
* executionPath.iterationIndex 和 cursor loopIterations 继续使用 zero-based 内部位置。
* loop_iteration_* event 的 iterationIndex 继续 zero-based，iteration 继续 one-based，并应与 template {{index}} 相等。

## Template grammar

唯一合法 token：

~~~text
{{index}}
{{key}}
{{value}}
~~~

规则：

* template 必须至少包含三个 exact token 中的任意一个；允许单独、重复或混合使用。
* 不支持 whitespace variant、大小写变体、path、expression、filter、default、function、escape 或 outer access。
* {{text}} 是 unknown token，必须 validation fail；不提供 alias 或 rewrite。
* 未闭合 {{、孤立 }} 和任意其它双花括号 token 都 validation fail。
* renderer 必须对原始 template 做一次 union scan/callback replacement，禁止按 token 顺序多轮 replace。
* 插入的 key/value 即使包含 {{index}}、{{key}}、{{value}} 或 {{text}} 也不再扫描。
* 普通 literal string 或 { kind: "text" } 永不插值，其中任意双花括号按原字符保留。
* artifact、runtime input、capture output 和 rendered output 永不二次插值。

示例：

~~~text
第 {{index}} 阶段：{{key}}
{{value}}
~~~

对 item { key: "边界策略", value: "处理 {{index}}" } 的第二轮输出必须是：

~~~text
第 2 阶段：边界策略
处理 {{index}}
~~~

## Lexical scope 与 cursor

text-list 每轮创建完整 immutable binding { index, key, value, forStepId }：

* if/elif/else、control-terminal action body、内层 count/forever 和 parallel lane 继承同一 binding。
* 内层 text-list 同时 shadow index/key/value；退出后同时恢复外层。
* 不允许某个 token 取内层而另一个 token fallback 到外层。
* Parallel lanes 获取当前 binding 的 immutable snapshot，不能互相污染。
* Root 或无 text-list ancestor 的 template 保持 out-of-scope invalid 行为。

Execution cursor 的动态 identity 仍只使用 executionPath，不使用 key/value。暂停、wait、input、capture 和 parallel resume 必须恢复准确 iteration 的完整 binding。Cursor snapshot JSON round-trip 必须保留 index/key/value，且 restore 后与 snapshot 对象分离。

Run event 不得新增独立的 index/key/value binding snapshot 字段。loop event 继续只记录 rangeKind=text-list、iterationIndex、iteration、total 和 executionPath；既有 action event 仍可按当前 run-log contract 记录用户可见的 rendered title/prompt/summary，terminal/notify message 的 rendered content 继续通过 artifact/effect evidence 审计。

## Template editor

每个 text-list item card 固定显示：

~~~text
1
Key    [用户单行输入]
Value  [用户 multiline 输入]
~~~

序号节点只显示纯数字。不得显示 #1、Item 1 或把 index 做成 input。Key 使用单行 input；Value 使用 adaptive multiline textarea。空/重复 key 不产生 validation error，含 CR/LF 的 imported key 必须 schema fail。

进入 text-list 新建一个空 item。Add 增加 { key: "", value: "" }；Remove 至少保留一项；Up/Down 原子移动 key/value。切离含非默认 item 的 text-list 继续要求 destructive confirmation。

S1-S6 的 checkbox 文案统一为 Use loop template。Template 启用时展示当前 for source/shadow 信息，并提供三个独立 Insert 按钮。Insert 在当前 selection/caret 替换选区并恢复 focus/caret。Collapsed summary 显示 text-list、三个 token 和 item count。

移动 template consumer 出 scope 后仍保留 template object 和正文，显示 inline error并只允许关闭 template；移回后恢复三个 Insert 和 scope source。

## Adaptive textarea

同目录矩阵列出的 multiline 正文统一使用同一个 adaptive editor。自动高度按当前实际渲染宽度的 scrollHeight 计算，因此 soft wrap 和显式换行都计入视觉高度。

定义：

~~~text
contentHeight = textarea 在当前宽度下完整内容的 scrollHeight
autoHeight = min(contentHeight + oneLineHeight, autoMaxHeight)
displayHeight = max(autoHeight, temporaryManualHeight ?? 0)
~~~

约束：

* 空 textarea 至少保留可编辑高度；实际一行内容默认多显示一行空间。
* 组件 mount、value 变化、宽度变化、font/line-height 变化和 template/literal 切换后重新计算 autoHeight。
* autoHeight 达到 autoMaxHeight 后不再自动增长，overflow-y 变为 auto。
* 保留 native resize: vertical。用户只能临时放大到不小于 autoHeight；缩到 autoHeight 容差内即清除 manual override。
* temporaryManualHeight 可以超过 autoMaxHeight，但 hard max 为 60vh；超过 hard max 的拖动被 clamp。
* manual override 存在时，value 更新不得把高度缩回；若新的 autoHeight 更大，则 displayHeight 跟随更大值。
* manual override 只存在组件内存，不写 macro template、run state、localStorage 或服务端；刷新、重新打开/重新 mount 后恢复自动高度。
* item reorder/remount 可以丢弃 manual height，且不得把某一 item 的临时高度持久化到另一 item。
* 内容超过当前 displayHeight 时可滚动；line-number gutter 与 textarea scrollTop 保持同步。
* 自动测量不得把程序性 resize 错记为用户 manual override。

auto cap 使用当前 surface 的既有视觉预算，而不是强迫全部正文同高：

| Surface | autoMaxRows |
| --- | ---: |
| send/notify/parallel message text/template part | 3 |
| text-list item Value | 3 |
| input.prompt / wait.user-continue.prompt | 3 |
| macro template description | 3 |
| runtime input textarea | 4 |

60vh 是统一 hard max。窄 panel 下不得产生横向页面 overflow；toolbar 和 token buttons 可以 wrap。

## Surface 边界

Template checkbox 和 adaptive editor 是两套独立 whitelist：

* Template capability 仍严格限于 S1-S6。
* Adaptive editor 只用于矩阵 A1-A6 的 multiline 正文。
* notify.title 仍是 S3 template-capable，但保持单行 input，不使用 adaptive textarea。
* input.prompt 和 wait.user-continue.prompt 从单行 input 改为 adaptive multiline 正文。
* text-list Key 是 binding source 且单行；Value 是 binding source且 adaptive，但两者都没有 template checkbox。
* metadata、identity、condition、regex、separator、selector、Prompt Library body 和 terminal TextBoxSlot 不因本任务改变。

## 测试与 Close Gate

Schema/unit 必须覆盖 object items 正反例、旧 string[]/mixed/entry-list/{{text}} rejection、key newline、空/重复 key/value、三个 token 单独/混合、malformed token、literal 保真和 one-pass non-recursion。

Runner/cursor 必须覆盖 index/key/value 顺序、重排后的 index、nested shadow/restore、count inheritance、parallel、pause/resume、cursor snapshot、artifact occurrence 和 event iteration 对齐。

Editor E2E 必须覆盖 item key/value CRUD/reorder/reload、纯数字 index、S1-S6 三 token controls、out-of-scope move、A1-A6 auto grow/cap/overflow、soft wrap、临时 drag 后输入不缩回、hard cap、remount reset 和窄宽度。

Close Gate：

* 新增稳定 just test-026 入口。
* just check。
* just test-unit。
* git diff --check。
* Legacy Kill List 搜索不再有生产代码 {{text}}、string[] text-list、entry-list、alias/migration/convert 分支。
* AI post-review 无未解决 P1/P2，active specs、quickstart、task index 与最终源码一致。
