# 20260627A.006 Capture Source And Agent Event Adapters

## 任务概括

交付真实 capture source adapter：默认 `terminal-buffer`、统一 `AgentEvent Ingest` endpoint、Codex Stop hook adapter 和 JSONL spool fallback。完成后，runner 可以从用户选择的 source 生成 capture artifact，但还不调用真实 parser。

## 正式 task 级别及定级原因

三星任务。

本任务连接 terminal 世界和 agent callback 世界。风险在于不能让 Codex hook 细节污染 runner，也不能把 TUI buffer 假装成可靠结构化真值。parser 模型调用留给 `.007`。

## 范围内

* `terminal-buffer` capture adapter。
* `AgentEvent Ingest` local HTTP endpoint。
* Codex Stop hook adapter integration。
* `agentSessionId` 和 `adapterMetadata.codexSessionId` 必填校验。
* JSONL spool fallback 和导入。
* capture raw artifact 与 normalized artifact 写入。

## 范围外

* 不调用 `regex` 或真实 `ai-json` parser。
* 不实现 parser profile fixtures。
* 不做 Codex session 自动恢复。
* 不做系统级 command/file audit。
