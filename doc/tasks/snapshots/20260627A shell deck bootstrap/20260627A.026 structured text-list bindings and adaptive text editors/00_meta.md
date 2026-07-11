# 20260627A.026 Structured Text-List Bindings And Adaptive Text Editors

## 任务概括

把 .025 的单值 text-list 破坏性替换为结构化 item：每轮提供自动 index、用户 key 和 multiline value，并把 scoped template token 收敛为 exact {{index}}、{{key}}、{{value}}。同时统一 Macro 正文 textarea 的内容自适应高度，保留不持久化的临时手动放大。

## 正式 task 级别及定级原因

三星任务。

本任务直接替换公开 Flow V2 text-list schema 和 template grammar，修改 validator、runner binding/cursor、Macro editor、S1-S6 template controls、run-log 证明与 E2E。旧 string[] 和 {{text}} 将被明确拒绝而非迁移，因此必须先冻结 hard-cut contract，并完成 schema/runner/editor 的全链路 Gate。

## 当前状态

Implementation landed；automated Close Gate passed。

## 范围内

* 将 text-list items 唯一合法形态改为至少一项的 { key: string, value: string }[]。
* index 由数组位置生成，模板输出纯 1-based 十进制数字；JSON 和 execution identity 不存重复 index。
* template grammar 唯一支持 exact {{index}}、{{key}}、{{value}}，并保持 literal/template 显式区分和 one-pass rendering。
* 保留 .025 的 S1-S6 template capability whitelist、词法继承、nested shadow、parallel immutable binding 和准确 pause/resume。
* 为 Macro multiline 正文编辑器增加实际内容高度加一行的 auto height、auto cap、内部滚动和临时手动放大。
* 更新 schema、runner、cursor、run events、editor、unit/integration/E2E 和最终 active docs。

## 破坏性边界

* 不接受 text-list items: string[]、mixed items、entry-list 或任何别名。
* 不接受 {{text}}，不提供 alias、migration、Convert UI、dual schema、legacy branch 或自动 rewrite。
* 旧输入按 current schema fail loudly；不得猜测 key、value 或 token 意图。
* .025 snapshot 作为历史交付证据保持不变；.026 实现收口后由新 active spec 取代其当前设计真值。

## 范围外

* 不实现 dynamic list source、object path、表达式、filter、default、escape、outer binding 或 count/forever 自身 index token。
* 不把 key 变成 identity、selector 或 lookup key；不要求 non-empty 或 unique。
* 不持久化 textarea 手动高度，不把 UI layout 状态写入 macro JSON/localStorage。
