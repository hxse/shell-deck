# Binding And Autosize Matrix

## 规范地位

本文件同时冻结两份独立白名单：

1. 哪些 runtime content field 可以显示 Use loop template checkbox。
2. 哪些 multiline 正文使用 adaptive textarea。

实现不得用“字段是 string”“位于 text-list 内”或“当前是 textarea”自动推导能力。未列入名单的 surface 保持原控件和语义。

## Template capability：S1-S6

一个字段只有同时位于下表且拥有 enclosing text-list lexical scope 时，才能从 literal 开启 template。三个 token 总是作为完整集合提供；不得按字段删减。

| 编号 | JSON / Editor surface | 控件 | Template |
| --- | --- | --- | --- |
| S1 | 普通 send.message.parts[kind=text] | adaptive multiline | {{index}} / {{key}} / {{value}} |
| S2 | parallel.lanes[].body[] 中 send.message.parts[kind=text] | adaptive multiline | parallel 继承 enclosing binding |
| S3 | notify.title | 单行 input | 三 token；不参与 autosize |
| S4 | notify.message.parts[kind=text] | adaptive multiline | 三 token |
| S5 | input.prompt | adaptive multiline | 只模板化 prompt，不模板化 runtime input |
| S6 | wait.mode=user-continue 的 prompt | adaptive multiline | duration/terminal-quiet 不支持 |

Checkbox 状态：

| Capability | Scope | Value | UI |
| --- | --- | --- | --- |
| S1-S6 | 有 | literal | 显示未勾选 Use loop template |
| S1-S6 | 有 | template | 显示已勾选、source/shadow 和三个 Insert |
| S1-S6 | 无 | literal | 不显示开启入口 |
| S1-S6 | 无 | template | 保留正文/勾选，显示 field-local issue，只允许关闭 |
| 非 S1-S6 | 任意 | 原字段类型 | 永不显示 checkbox |
| 非 S1-S6 | 任意 | template object/part | schema fail |

Message part 独立切换；scalar field 独立切换。开关只改变 literal/template wrapper，不 trim、不插 token、不改正文。Template mode 下 {{text}} 和其它 unknown token 显示 syntax issue并阻止保存/start。

## Binding source

text-list item card：

| Surface | 可编辑 | Multiline | Template consumer | 运行时 binding |
| --- | --- | --- | --- | --- |
| 显示 index | 否；纯数字 | 否 | 否 | {{index}} |
| item.key | 是 | 否；CR/LF invalid | 否 | {{key}} |
| item.value | 是 | 是 | 否 | {{value}} |

Key/value 是 source，不能引用自身或 enclosing binding。内层 text-list 原子 shadow 三个 token；外层不提供显式访问。

## Adaptive textarea：A1-A6

共同 contract：实际视觉 content scrollHeight 加一行、达到 autoMaxRows 后内部滚动、保留临时 native vertical resize、temporary manual height 不持久化且 hard max 60vh。

| 编号 | Surface | autoMaxRows | Template capability |
| --- | --- | ---: | --- |
| A1 | S1/S2/S4 message text/template part | 3 | 按 S1/S2/S4 |
| A2 | text-list item.value | 3 | 无；binding source |
| A3 | input.prompt | 3 | S5 |
| A4 | wait.user-continue.prompt | 3 | S6 |
| A5 | macro template description | 3 | 无；metadata |
| A6 | Macro Run runtime input | 4 | 无；用户运行时数据 |

A1-A6 必须使用共享 adaptive implementation。外部 value 更新和宽度变化重新测量；manual override 存在时不得因输入缩回。60vh 是 hard max，不是 auto target。

## 明确排除

以下字段不获得 template checkbox，也不改为 adaptive textarea：

| 类别 | Surface |
| --- | --- |
| Binding source single-line | text-list item.key |
| Template-capable single-line | notify.title |
| Metadata/identity | template name、template/node/lane/output id、configId |
| Terminal/reference | terminal id/alias/index、artifact source、profileId |
| Control/config | reason、lane label、merge separator、wait config、capture config |
| Matcher/parser | simple matcher text、regex pattern/flags、extract split/filter/group |
| Workbench search/chrome | selector search、filter、JSON preview controls |
| Separate long-form editor | Prompt Library body |
| Terminal surface | TextBoxSlot textarea |

普通 string 中的 {{index}}、{{key}}、{{value}}、{{text}} 都保持 literal。Regex/separator 按自身 grammar 处理。

## Editor checks

* Card index 文本必须精确等于 1、2、3，不含前缀或符号。
* Add/Remove/Up/Down 后 key/value 成对移动，index 按位置更新。
* 三个 Insert button 都在 selection 处替换并恢复 focus/caret。
* Narrow viewport 下 Key、Value、toolbar 和 actions 不产生横向页面 overflow。
* A1-A6 分别证明短内容收缩、内容增长、auto cap 和 overflow；共享组件在代表性 config/runtime surface 证明 remount reset。
* 至少一个 adaptive editor 证明 native vertical resize 放大后继续输入不缩回，且不能超过 60vh；结构化 item/part 重排不得把 manual height 串给新内容。
* S1-S6 分别证明有 scope/无 scope状态；排除项位于 text-list 内仍不能获得 template。
