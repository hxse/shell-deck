# Problem Context

`runs/<runId>/events/`已经只保留最近1000条event，但completed run目录总数、每个run的artifacts以及`agent-events/`原始JSONL没有总量边界。长期运行Codex hook、生成大型artifact或积累大量Trace后，User Data Root会持续增长，最终可能耗尽用户磁盘。

配额必须覆盖完整evidence单位。只限制event JSONL而不计artifact不能解决问题；逐文件删除run内部内容又会制造manifest、summary、events和artifact互相不一致的残缺Trace。AgentEvent当前每个Room generation只有一个持续追加的JSONL，也没有“已经关闭、可以安全删除”的边界。

本任务采用有限且明确的storage GC，不建立通用retention平台：

* run只在已有terminal event后成为可删除历史单位，并始终以整个目录回收；
* terminalized run若仍是live Room的current runner snapshot，继续由跨process存活pin保护，不能因为cursor cache已淘汰就删除；
* AgentEvent改为固定大小rolling segment，只有从open原子切换为closed的segment可删除；
* quota lock必须覆盖admission与durable publish，每条run/AgentEvent line都不能绕开；
* active/interrupted run与open segment宁可触发`log_storage_limit_reached`，也不根据mtime猜测其已失效；
* MacroRecord等用户配置不计入日志配额。
