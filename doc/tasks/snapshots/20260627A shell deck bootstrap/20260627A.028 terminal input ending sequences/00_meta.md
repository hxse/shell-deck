# 20260627A.028 Terminal Input Ending Sequences

## 任务概括

把 Macro `send` / `input` 的 `enter: boolean` 破坏性替换为显式 `ending`。用户可以选择不追加、LF、CR 或 CRLF；新建 action 默认 CR，使 Macro 在普通 shell 与 Codex 等 raw-mode TUI 中都能准确表达 terminal input 结尾。

## 正式 task 级别及定级原因

三星任务。

本任务同时修改公开 Macro JSON、type/validator/store/import、runner terminal write、run-event evidence、普通与 parallel 编辑器、测试 fixture、active spec 和 guide。错误实现可能在 canonical shell 中看似成功，却在 raw-mode TUI 中 quietly wrong；旧 `enter` 若在任一入口继续被读取，还会形成 dual schema。因此必须用完整 Spec、Execution、Legacy Kill、AI pre/post-review 和 Breaking Close Gate 收口。

## 范围内

* `send`、`input` 和 parallel lane `send` 必须显式存储 `ending: "none" | "lf" | "cr" | "crlf"`。
* 单一「Ending sequence」select 替换 `Submit with Enter` checkbox；新建 action 显式默认 `ending: "cr"`。
* Runner 按 enum 精确追加 `""`、`"\n"`、`"\r"` 或 `"\r\n"`，不模拟 DOM keyboard event。
* `terminal_text_sent` 新 event 记录当前 `ending`，并继续以 content/write artifacts 保存追加前后的完整证据。
* Validator、store、HTTP template、runner start 和 editor import 对缺失/非法 `ending` 或旧 `enter` fail loudly。
* 更新 unit/integration/E2E、focused just 入口、active spec、guide、task index 和最终 review evidence。
* 不提供 migration、alias、dual reader、自动转换或 schema default；旧 template 由用户删除或按当前 schema 重写。

## 范围外

* 不增加通用 keyboard event、special key 或 escape-sequence DSL。
* 不修改浏览器 xterm 物理键盘输入链路、PTY helper framing、terminal manager 转发或 shell line discipline。
* 不增加 Codex/TUI 专用分支；CR 只是 xterm Enter 的通用 terminal input sequence。
* 不改变 message parts、template rendering、artifact resolution、pause/resume cursor 或 parallel lane 范围。
* 不回写历史 task snapshots，也不重写已经落盘的 append-only run events；历史 event data 仍按通用 event replay 读取，但 current producer、demo 和 fixture 只写新 evidence。
* 不提升 `schemaVersion`；`schemaVersion: 2` 直接执行 current-schema-only hard cut。
