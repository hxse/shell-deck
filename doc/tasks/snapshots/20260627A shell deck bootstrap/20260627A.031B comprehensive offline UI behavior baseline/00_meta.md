# 20260627A.031B Comprehensive Offline UI Behavior Baseline

## 任务概括

以 `20260627A.031` 的最终 revision `1236af61` 作为 `.031A` 产品行为基线，新增一套完全离线、完全自动化、以真实用户操作为唯一主路径的 UI behavior baseline。测试从空 config 开始，不通过 HTTP API 预置 terminal、Macro、Prompt、run 或 artifact；它必须仅通过浏览器 UI 创建 terminal、从零搭建复杂 Macro、保存并运行、在多个 terminal 中发送与 capture 结果，并覆盖 `.031A` 除 Codex / `agent-event` 之外的全部可交互 UI surface。

`.031B` 冻结的是 `.031A` 当时的产品行为，不把后续 `.032+` 的新设计提前写回基线。后续 change 若明确改变了产品 contract，可以在该 change 内同步更新测试、control inventory 和断言，但必须记录对应 task、旧行为、新行为与更新理由；未被新 contract 改变的行为继续受 `.031B` 防漂移保护。

## 正式 task 级别及定级原因

三星任务。

本任务原则上不改变产品 contract，但会建立覆盖 workspace、terminal、Macro visual/JSON/Trace、Prompt、Settings、notification、runner 与所有结构编辑 controls 的长链路 Playwright baseline，并增加静态 interactive-control inventory。它涉及真实 browser、WebSocket、fake/real/text terminal、文件 download/import、clipboard、drag/resize、runner timing、artifact preview 和大量动态 UI state；测试若设计不当会产生高脆弱性或反过来冻结错误行为，因此需要完整 spec、分层执行计划、明确排除项和基线审阅。

## 范围内

* 建立 `.031A` 非 Codex UI 的完整 control inventory，覆盖 button、icon button、tab、details/summary、input、select、textarea、checkbox、range、file input、drag、resize、double-click、keyboard 和 click-away。
* 建立单一 `just test-031b` 离线入口；核心是一条从空 config 开始、只经 UI 创建和运行复杂 Macro 的用户旅程。
* Macro 必须由 visual editor 从零搭建，不能通过 API import 或测试 fixture 注入；JSON Import 只允许导入本次旅程先经 UI Export 得到的文件，用于测试真实 Import control。
* 旅程必须创建并实际使用 fake、real shell 和 text terminal；不调用 Codex、不访问网络、不依赖 Telegram。
* 旅程必须覆盖多 terminal send、terminal-buffer/text-box capture、extract、if/elif/else、for/text-list/template、parallel lanes、wait/input/notify、finish/break/continue，以及 Save/Start/Pause/Resume/Stop/Trace/artifact preview。
* 覆盖 Macro CRUD、search/select、Copy/Export/Import/Duplicate/Delete 等 `.031A` 当时存在的行为；后续 task 删除或改变这些行为时必须带 task attribution 更新基线。
* 覆盖 Prompt CRUD/search/scope/copy/delete、panel visibility/resize/reset、Settings、terminal tab rename/reorder/close、Text line numbers/copy、JSON read/edit/invalid/save/cancel/copy/export 与 dirty lock。
* 增加静态审计，保证每个非 Codex button 都有稳定 identity，并且必须被 runtime journey 点击、被明确断言为 disabled boundary，或在带理由的 exclusion 中登记。
* 对重复渲染的同一语义 control，至少覆盖一个真实可执行实例，并覆盖其 enabled/disabled、confirm cancel/accept、collapse expand 或 move boundary 等不同语义状态。
* 测试运行产生的 data root、download、shell 工作目录和临时文件全部位于测试临时目录；测试结束不污染项目或用户长期数据。
* 若完整 journey 复现了明确违反 `.031A` 已冻结 active spec 的实现缺陷，允许在 `.031B` 做最小、局部的 contract-conformance 修复；必须在 `04_review` 登记复现、根因、修改边界和回归证据，不得借此改变既有 contract。

## 范围外

* 不运行 Codex，不访问 OpenAI，不测试 `capture kind = agent-event`、`capture-agent-kind`、`capture-agent-mode` 或 Codex hook。
* 不以 API 直接创建/修改 terminal、Macro、Prompt、run、artifact 或 runner state。
* 不把视觉 screenshot / pixel diff 当成主要真值；关键几何、颜色和可见状态继续使用 DOM/computed-style contract。
* 不在 `.031B` 提前实现 `.032+` 的 Room、controller、MacroRecord V3、Library 或其他后续设计。
* 不为了让测试通过而修改产品语义。没有既有 spec 真值支撑的产品缺陷只登记 finding，不在 `.031B` 自行拍板；仅允许上一节定义的最小 contract-conformance 修复。
* 不承诺在一个实例中逐个点击每个重复 node 的同名按钮；冻结的是 semantic control 与关键状态矩阵，不是重复 DOM 数量。

## 历史命名说明

用户将父行为基线命名为 `.031A`，新测试任务命名为 `.031B`。当前 jj 环境把父 revision `1236af61` 标记为 immutable `dev/main`，因此本 change 未重写其历史 description 或 task 路径；本文中的 `.031A` 均指该固定父 revision 的产品行为，不表示已经绕过 immutable-history protection。
