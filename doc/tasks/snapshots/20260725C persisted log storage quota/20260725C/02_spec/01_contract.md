# Persisted Log Storage Quota Contract

## 任务边界

本任务只约束User Data Root中的durable logs/evidence，不改变Macro schema、Trace HTTP shape、runner lifecycle、AgentEvent protocol、MacroRecord或notification config。删除是current-schema行为，不提供undelete、migration、legacy read、pin或export。

## 配额

默认limit为`2147483648` bytes（2 GiB）。显式`StartOptions.logStorageLimitBytes`优先，否则读取`SHELL_DECK_LOG_STORAGE_LIMIT_BYTES`，只有变量真正缺失时使用默认值。变量存在但为empty/whitespace，或配置不是十进制positive safe integer时，都在server bind或写入前以`invalid_log_storage_limit_bytes`失败。`0`不表示关闭配额。

计量单位是以下两个managed root内全部regular file的logical byte size：

* `runs/`：manifest、summary、event segment、artifact与derived Trace index；
* `agent-events/`：closed/open AgentEvent segment。

`macros/`、`notification-profiles.json`、`.locks/`及其他路径不计入。directory entry和filesystem block overhead不计。

当`current bytes + admitted bytes >= limit`时，在`<User Data Root>/.locks/log-storage-gc.lock`内fresh scan并GC，目标为精确整数`floor(limit * 9 / 10)`；实现必须先做安全的quotient/remainder分解，不能用可能超出safe-integer精度的`limit * 9`中间值。按以下顺序删除，达到目标即停止：

1. `run_completed`、`run_failed`或`run_stopped`结尾的terminalized run，按authoritative summary `updatedAt`、再按run ID从旧到新；
2. closed AgentEvent segment，按close后的mtime、再按path从旧到新。

如果候选耗尽后projected usage仍达到limit，操作以`log_storage_limit_reached`失败；不得继续写、截断active文件或静默丢event。候选只能把usage降到limit以下但无法达到90%时允许继续，不能为了追求水位删除受保护数据。

所有会增加quota bytes的production写入必须使用同一个atomic admission primitive，让GC lock覆盖`fresh scan → candidate cleanup → admission → durable publish`，不能在admission返回后释放lock再写。范围包括manifest及其Trace index增长、artifact、每条run event及其可能的summary checkpoint、每条AgentEvent完整JSONL line。incoming budget采用当前operation的UTF-8 bytes或保守上界；跨process writer必须在前一个publish进入fresh usage后才允许后一个admission。

Trace index的known add/remove与missing/corrupt cold rebuild都属于上述写入。所有写入固定按`log-storage-gc.lock → trace-index.lock`取得锁；cold rebuild在quota lock内动态计算新index相对当前文件的positive byte growth，若GC删除run，必须从删除后的manifest集合重新计算growth和最终内容，不能把pre-GC entry重新写回。index没有增长时仍由quota lock串行publication，但不为纯replace/shrink额外触发GC。

## Run retention

run的删除单位始终是`runs/<runId>/`完整目录，包含manifest、summary、retained events和全部artifacts。terminal kind必须通过现有EvidenceStore cold freshness truth取得，不能只信任可能stale的summary。

以下run永不自动删除：

* 仍被live Room作为current runner snapshot引用的run，即使它已经terminalized并释放了event cursor/window；
* 没有terminal event的active或interrupted run；
* 只有reserved directory、尚未durable start的run。

current Room引用通过`<User Data Root>/.locks/log-storage-current-runs/<runId>.json`持久化pin，记录owner PID与Linux process start time。新run必须先publish pin再安装为Room current run；下一次Start安装replacement后才移除旧pin，Room Destroy移除当前pin。GC在同一lock内验证pin process identity，live pin跨server process生效，crash遗留stale pin可清理；不能依赖process-local Map证明可删除。

删除先在同一`runs/` filesystem内把完整run目录atomic rename为private GC tombstone，使Trace不能观察逐文件删除；随后移除derived Trace index entry并递归删除tombstone。startup在GC lock内收口遗留tombstone。index缺失/损坏仍由现有cold rebuild contract修复。

检查时机：

* server startup；
* 新run reservation前；
* 每次artifact atomic write前，incoming使用UTF-8 byte length；
* 每条run event append，incoming覆盖完整event line与可能的summary checkpoint；
* run terminalization并释放live cursor/window后。

terminalization之后若没有同步请求可承载错误，server必须明确输出`log_storage_limit_reached`；下一次new run/artifact admission仍重新fresh scan并fail loudly，不能只依赖内存latch。

## AgentEvent rolling segment

current layout为：

```text
agent-events/<serverInstanceId>/<roomId>/<roomGeneration>/
  000000000001.open.jsonl
  000000000001.jsonl
  000000000002.open.jsonl
```

每个stream最多一个`.open.jsonl`。默认segment target为8 MiB；JSON event line不能拆分。每条line都在GC lock内先admit exact UTF-8 bytes，再执行可能的rotation与durable append。若current非空segment加下一条line会超过target，在同一admission中先close旧segment，再建立下一编号open segment并写入完整line。单条line可大于target，但仍必须作为一个完整line接受quota admission；达到limit时不能继续扩张既有open segment。

Room Destroy和正常server stop关闭本process已打开的对应segment；rotation/close在open filename仍受保护时先把mtime持久化为close time，再做`.open.jsonl -> .jsonl`原子rename。GC按这个close mtime排序，只允许unlink closed `NNNNNNNNNNNN.jsonl`，永不删除`.open.jsonl`。crash遗留open segment保持受保护；若它导致无候选可删，则明确达到storage limit，不根据age猜测。

同一stream cold read按segment number读取closed/open文件并继续建立现有eventId、terminal/launch/capture indexes。旧的`<generation>.jsonl` flat layout不迁移、不dual-read；发现时以`legacy_agent_event_log_unsupported`失败。

## Trigger与错误边界

startup检查在Bun bind前完成，失败时server不监听。任一AgentEvent line admission失败时HTTP ingest返回现有exact error projection中的`log_storage_limit_reached`，旧open segment保持完整。run event admission失败不能追加line或推进cursor；artifact admission失败使当前Macro按既有runner error boundary终态化，不产生artifact或`artifact_created` event。

所有GC与segment操作保持同步、串行、同一event loop内完成；本任务不引入后台timer、周期polling或第二份usage真值。多个server process共享root时只由GC lock串行删除；terminal event与closed filename是跨进程可删除性的唯一persistent truth。

## 测试

Focused Gate必须证明：

1. 默认2 GiB、explicit/env优先级、invalid limit和90%整数水位，包括接近`Number.MAX_SAFE_INTEGER`的精确结果；
2. 配额只统计`runs/`与`agent-events/`regular bytes，不统计MacroRecord；
3. oldest terminalized run按整目录删除，artifact与Trace index entry一起退出；active/interrupted run保留；
4. completed run不足时只删除oldest closed AgentEvent segment，open segment永不删除；
5. 没有可删除候选且达到limit时，startup/new run/manifest/artifact/run event/AgentEvent line均明确`log_storage_limit_reached`；
6. AgentEvent按编号rotation、cold read、duplicate detection、Room/server close和legacy flat fail-loud保持；
7. current Room completed run在低配额GC后仍支持direct snapshot、HTTP GET与WebSocket reconnect，直到next Start replacement或Room Destroy才解除pin；
8. 双process barrier证明同baseline的两个publish不能同时通过，run event line同样经过quota admission；
9. missing/corrupt Trace index rebuild必须经过quota admission；GC发生时最终index只包含post-GC run，无候选且空间不足时不发布index并返回`log_storage_limit_reached`；
10. close mtime、empty/whitespace environment和exact limit边界有回归；
11. `just test-20260725c`、`just check`、`just build`、完整unit/integration/E2E与`just diff-check`严格顺序通过；全部project-authored code文件不超过400行。
