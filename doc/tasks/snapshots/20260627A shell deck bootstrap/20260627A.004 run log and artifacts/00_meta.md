# 20260627A.004 Run Log And Artifacts

## 任务概括

交付 append-only macro run event log、artifacts 存储、derived state rebuild 和节点日志视图。完成后，系统能可靠记录和恢复宏运行过程，但还不真正执行完整 macro runner。

## 正式 task 级别及定级原因

二星任务。

本任务是 runner 的可观测底座。风险集中在日志真值不能分裂、artifact 引用不能丢、页面刷新后状态能重建。执行状态机留给 `.005`，避免本任务同时承担存储和编排复杂度。

## 范围内

* `.shell-deck/configs/<config-id>/runs/<run-id>/events.jsonl` append-only 写入。
* `artifacts/` 大文本存储和 event 引用。
* event envelope、run lifecycle event、step event 的基础 schema。
* derived latest state rebuild。
* 节点展开日志视图和 artifact 引用展示。
* 页面刷新后 paused/completed/failed/interrupted 状态恢复。

## 范围外

* 不实现 macro runner 状态机。
* 不执行 macro step。`send_line`、`sleep`、`input_line`、capture、parse、branch 和 control flow 留给 `.005+`。
* 不接入 Codex hook、regex parser 或 `ai-json` parser。
* 不实现 parser replicas disagreement。
* 不做系统级 command/file audit。
