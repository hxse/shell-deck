# Execution Plan

## Phase 1: Docs and Task Wiring

* 新建 .014 task 目录。
* 更新 task index、active specs 与 quickstart 中的 UI 口径。
* 新增 `test-014` just/package 入口。

## Phase 2: Run Log Real-Time Protocol

* 给 `RunEventStore` 增加 append listener。
* 在 server 启动时订阅 listener，广播 `run_log_updated`。
* 扩展 `ServerMessage` 协议。
* App 接收事件并传递给 RunLogView。
* RunLogView 根据 refresh token 自动 reload。

## Phase 3: Macro Workbench UI

* Macro side panel 改为左右 workbench。
* Template selector/search 替代平铺列表。
* Template CRUD toolbar 合并。
* Template drawer summary 与 Macro title 合并到 header 同一行；run status 保留在顶部 dock；Runner controls 移入 Editor 右侧 sticky tool rail 顶部，并纵向排列在 Actions / Flow 上方。
* RunLogView 放到 Macro 顶层 Trace tab，内部提供 Run Log / AI Trace tabs，并按 selected template 过滤。
* Terminal tab 增加 close 按钮与确认流程，作为本轮 workbench chrome cleanup 的附带功能。
* 隐藏 Flow V2 disabled 主按钮。

## Phase 4: Prompt Panel UI

* Prompt selector/search 替代 Browse/Edit 平铺。
* 移除 Preview。
* Prompt CRUD toolbar 合并。
* 保留 .013 的 scope move/delete safety 语义。

## Phase 5: Tests and Review

* 新增/更新 e2e 覆盖 .014 UI contract。
* 跑自动化 gate。
* 更新 04_review 结果和 verification。
