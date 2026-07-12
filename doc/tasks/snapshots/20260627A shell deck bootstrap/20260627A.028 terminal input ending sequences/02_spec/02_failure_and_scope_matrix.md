# Failure And Scope Matrix

## 规范地位

本文件冻结 `ending` 在 authoring、validation、runtime 和 evidence 边界的行为。实现不能依赖普通 shell 或 fake backend 的宽松行为来推断结尾字节正确。

## Macro input matrix

| 输入 | Type/check | Validator / store / HTTP | Runner |
| --- | --- | --- | --- |
| `ending:"none"` | 接受 | 接受 | 追加 `""` |
| `ending:"lf"` | 接受 | 接受 | 追加 `"\n"` |
| `ending:"cr"` | 接受 | 接受 | 追加 `"\r"` |
| `ending:"crlf"` | 接受 | 接受 | 追加 `"\r\n"` |
| 缺少 ending | 拒绝 | required-field issue；fail loudly | 不启动 |
| unknown/wrong-type ending | 拒绝 | enum issue；fail loudly | 不启动 |
| inherited/non-enumerable ending | 非 JSON canonical | own-enumerable issue；不得持久化 | 不启动 |
| `enter:true/false` | 拒绝 | unknown field；不得转换 | 不启动 |
| 同时含 enter 与 ending | 拒绝 | unknown enter；不得忽略 | 不启动 |

规则覆盖普通 send、input、control action body中的 send/input，以及 parallel lane send。Store/list遇到磁盘 invalid template继续整次 fail loudly，不 quarantine、不跳过。

## Runtime sequence matrix

| Surface | none | lf | cr | crlf |
| --- | --- | --- | --- | --- |
| send | raw content | content + LF | content + CR | content + CR + LF |
| input | raw submitted text | text + LF | text + CR | text + CR + LF |
| parallel send | raw content | content + LF | content + CR | content + CR + LF |

所有 surface 共享同一个 exhaustive sequence mapping。任何 missing/default branch 都是 contract violation。

## UI matrix

| Surface | 控件 | 新建值 | 持久化 |
| --- | --- | --- | --- |
| send | Ending sequence select | cr | 用户当前选择 |
| input | Ending sequence select | cr | 用户当前选择 |
| parallel lane send | Ending sequence select | cr | 用户当前选择 |

Select 必须包含 None、Enter / CR、LF、CRLF。旧 checkbox、旧 test id和 `Submit with Enter` 文案全部退出。

## Production Legacy Kill List

Close Gate 前必须删除 production/current docs/普通 fixture中的：

* `SendNode.enter`、`InputNode.enter`。
* `SEND_KEYS` / `INPUT_KEYS` 中的 `enter`。
* Validator 的 boolean enter check。
* `MACRO_ENTER_SEQUENCE` 与 `node.enter` runner 分支。
* `writeTerminalText(..., enter: boolean, ...)`。
* Current `terminal_text_sent` producer中的 `enter`、`enterSequence`。
* `Submit with Enter` checkbox、对应 test id和 mutation handler。
* 新建节点 `{ enter: true }`。
* Active spec/guide中的 `enter`、LF-only submit口径和示例。
* 普通 positive fixture中的 `enter:true/false`。

以下命中允许保留：

* 明确证明旧 Macro 写法失败的 negative tests。
* 历史 task snapshots，尤其 `.022` 的当时 contract。
* Append-only 用户 run log中已经存在的任意 data；实现不得为它增加 migration/legacy branch。
* 与 Macro 无关的浏览器 Enter key、terminal Enter UI/E2E命名或普通英文单词。

## 停止边界

本任务在四值 contract、三个 action surface、raw payload/evidence、editor persistence、旧写法失败和 current docs 全部通过 Gate 后结束。不得继续扩张到 terminal key DSL、TUI 类型探测、backend auto-selection、历史日志迁移或第三方程序行为适配。
