# 20260725C Persisted Log Storage Quota

## 任务概括

为User Data Root中的run evidence/artifacts与AgentEvent raw logs增加统一字节配额。默认2 GiB，达到配额时回收到90%水位；只删除terminalized historical run整目录与已经关闭的AgentEvent segment，不能触碰MacroRecord、active/interrupted run或仍可追加的segment。

## 任务级别

三星任务。它引入自动删除持久化evidence、跨进程GC lock、AgentEvent storage layout和新的persistence failure boundary；错误实现可能删除live truth、留下残缺run或在磁盘已满时静默丢日志。

## 范围

范围内：配额解析与统计、completed/stopped/failed run整目录清理、current Room run跨process pin、AgentEvent rolling segment与close timestamp、startup及每项durable log write的atomic admission、稳定错误码、focused regression、active spec、Quickstart和完整串行Gate。

范围外：MacroRecord与notification config；按天数/数量清理；pin、export或恢复已删除evidence；旧AgentEvent flat JSONL迁移/dual read；HTTP/WS/Macro resource envelope；Origin/session proof；异步批量fsync或通用disk quota daemon。
