# 20260725B Server Consistency Guards

## 任务概括

修复五个已经有明确正确语义的内部一致性缺口：Trace 直接分页时先修复 stale summary、WebSocket 只向 upgrade 时看到的 Room generation 注册、content edit lease 在授权丢失时精确回滚、Trace index 使用统一 `.locks/` 路径，并在 400 行 hard limit 之前提供 350 行 soft advisory。

## 任务级别

三星任务。它不新增产品功能，但同时触及 durable evidence、Room controller、跨进程 content lease、filesystem lock 和默认 Code Gate；这些链路出错时容易形成不报错但状态错误的 quietly-wrong 结果。

## 范围

范围内：上述五项代码、focused regression、默认测试发现、相关 active spec、task index 和完整串行验证。

范围外：浏览器 Origin / Host / session proof；LAN authentication；HTTP、WebSocket、Macro、terminal、client 或 regex 的 resource envelope；run、artifact 与 AgentEvent retention；同步 append/fsync batching；主动拆分当前 350–400 行文件；任何 UI、schema、protocol payload 或公开用户流程变化。
