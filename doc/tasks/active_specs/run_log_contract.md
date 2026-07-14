# Run Evidence Foundation Contract

`.032` 将 run event log 与 artifact 放入 User Data Root 的 `runs/<runId>/`。每个 event 保存 immutable `serverInstanceId + roomId + roomGeneration` provenance、monotonic `eventSeq`、generated eventId、kind、timestamp 和 data；artifact 先以 private atomic file 写入，再追加 `artifact_created` evidence。

Trace/artifact 是只读 evidence，不是 runtime checkpoint。Room、runner cursor 和 run snapshot 不持久化；server restart、Room generation 改变或 Destroy 后绝不从 event log 恢复 runner。`.034` 接入 production runner 后继续使用这一 provenance 边界并派生 interrupted/room-destroyed 状态。

旧 config-scoped run path 和 `run_log_updated.configId` 不属于 current runtime；完整 Macro Trace UI 与 event registry 由 `.034` 原子接回。
