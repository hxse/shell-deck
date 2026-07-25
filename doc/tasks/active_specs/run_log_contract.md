# Macro Run Evidence Contract

## Durable evidence

每次成功启动都在 User Data Root 的 `runs/<runId>/` 建立 current-schema-only evidence：

* `manifest.json` 保存 `RunManifestV1`，包含frozen runnable MacroDefinitionV5、canonical SHA-256 definition hash、MacroRecord id/revision、serverInstanceId、roomId、roomGeneration、terminalStructureRevision及frozen index/type/terminalId/launchId bindings。persistable但含unassigned的definition不能Start，因此不会产生manifest或`run_started`。
* `events/` 按100条一个segment保存最近的durable event tail；文件名是segment首个绝对`eventSeq`。每个event包含immutable Room provenance、monotonic absolute eventSeq、generated eventId、kind、timestamp与data。
* V0固定最多保留最近1000条event，不提供配置。跨过上限时只删除最旧完整segment，因此steady retained window为901至1000条；旧event永久删除，不提供历史分页。
* `summary.json`永久保留run开始/更新时间、firstAvailableEventSeq、lastEventSeq、totalEventCount、discardedEventCount与lastEventKind。eventSeq不因retention重新编号，Trace必须明确显示已删除数量。
* artifact先以private atomic file写入，再追加`artifact_created` event。text artifact保存`.txt`；structured Capture的`captured_json`以key稳定排序的pretty JSON加末尾LF保存`.json`。event retention不删除artifact；artifact只随整个run evidence被显式清理。
* complete JSONL line已经写入但file/directory fsync或summary checkpoint报告不确定时，append按相同event intent与绝对sequence检查authoritative tail并幂等收口，不能追加第二个同序号event。crash留下的partial final line在下一次read/append前截断。
* live run在内存维护provenance、next event sequence与bounded event window；正常append只写新增event，不读取完整segment或完整run。`summary.json`在run开始、segment边界、retention推进和终态checkpoint，冷读可从首尾segment修复stale summary。

production ownership保持单向：`EvidenceStore`是run evidence唯一public facade以及append cursor/maintenance debt owner；internal segment storage只执行JSONL append/recover/read/prune，record validation只执行current exact codec与intent equality。其他production consumer不得直接import这两个internal module或绕过Store写evidence。

全部run evidence/artifact与AgentEvent raw log共享默认2 GiB logical-byte quota；显式`StartOptions.logStorageLimitBytes`优先，否则只有`SHELL_DECK_LOG_STORAGE_LIMIT_BYTES`缺失才使用默认值，present empty/whitespace或非positive safe integer必须失败。usage达到limit后在`.locks/log-storage-gc.lock`内fresh scan并回收到精确整数`floor(limit * 9 / 10)`水位，计算不能产生超出safe-integer精度的乘法中间值：先按terminal summary `updatedAt`删除oldest `run_completed/run_failed/run_stopped`整个目录，再按持久化close mtime删除oldest closed AgentEvent segment。active/interrupted/reserved run和`.open.jsonl`永不删除；候选耗尽后usage仍达到limit则以`log_storage_limit_reached`失败。MacroRecord、notification config与`.locks/`不计入quota。

GC lock必须覆盖`fresh scan → admission → durable publish`；manifest/Trace index增长、artifact、每条run event与summary checkpoint、每条AgentEvent line都不能在lock释放后再写。Trace known mutation和cold rebuild统一按quota → trace取得锁，动态admit实际positive growth；GC删除run后必须从post-GC manifest集合重新计算并发布index，空间不足时不创建或扩大index。whole-run GC先把`runs/<runId>`在同一filesystem atomic rename为`.gc-<runId>`，再删除derived Trace index entry与tombstone；startup收口遗留tombstone。

terminalized run即使已经淘汰live event cursor/window，只要仍被live Room作为current runner snapshot引用，就由`.locks/log-storage-current-runs/<runId>.json`跨process pin保护。pin使用PID/process start identity验证存活，在new Start安装replacement后替换，在Room Destroy时清除；stale crash pin由GC清理。检查发生在startup、新run、每项durable log write、run terminalization及AgentEvent close。暂不提供age/count、用户pin、export或undelete。

Start按manifest publish → `run_started` append → 无await安装in-memory run的顺序提交。任一阶段失败都不能伪装成已启动；Destroy会关闭Room admission并使在途Start在await后复核generation/lifecycle，不能在已销毁Room中重新安装run。

## Runtime-only state

runner cursor、run snapshot、Pause/Resume waiters、pending input、pending structured Capture、typed artifact map、frozen routing map与active structure lock都只存在于当前server process。Pause/Resume是同一live run中的精确运行时暂停/恢复；server restart、Room Destroy或generation变化后返回`run_not_active`，绝不从manifest、event、artifact或Trace恢复runner。

production ownership保持单一：`MacroRunnerService`是HTTP/server consumer唯一public facade；internal lifecycle唯一持有Room-to-`LiveRun` registry，interaction只原地操作该对象，publication唯一持有Room-local runtime revision并通过live getter读取current run。structured ingest只通过runner facade提交，不能读取run map；internal module不得缓存、序列化或复制pending input、pending structured Capture、pause waiter、timer、artifact或parallel progress。

Running、Paused、Waiting input与Stopping期间，Room terminal structure由active-run lock冻结；lock acquire与release都是authoritative Room state change并推进roomRevision。Room Home的generation-bound Destroy仍可用，并会停止run、记录终态或留下可解释的interrupted evidence。

runner必须在tight loop内定期让出macrotask并在yield后复核abort/pause。Input submit的durable event先于pending resolver清除和Running状态发布；append失败保持waiting input可重试。每个run最多一个terminal event，终态后不得继续追加step event。

live runtime通过Room WebSocket同步：run-start、connect/reconnect、identity change或gap repair发送包含frozen definition与bounded event tail的authoritative `runner_snapshot`；Start/Pause/Resume/Stop/Input等HTTP success只返回不含definition/events的compact action ack，pending input最多只回传invocation ID、input revision与waiting status，不回显正文。普通transition发送`runner_delta`，只含`definitionHash`、expected/new runtime revision、mutable state、new events、window metadata与`stateHash`，不得重复携带definition或完整runningMacro。definition在Start时canonical hash并deep-freeze一次；后续full snapshot直接复用同一live projection，run内不再重复clone/hash。

client按Room generation、run ID、definition hash、published runtime revision与absolute eventSeq合并candidate，再对`definitionHash + 完整mutable state + retained event window`的canonical projection验证全量state hash；任何gap/hash mismatch都不能安装candidate，必须进入generation-bound single-flight HTTP full repair。一次transient repair失败不会放弃：每批最多三次（立即、100ms、300ms），耗尽后保留pending，仅由focus、reconnect或后续runner message继续，绝不恢复周期polling。关闭全部browser不停止run，晚到browser立即取得当前snapshot。terminal state最终publication attempt结束后即淘汰live event cursor/window cache，client delivery失败或Room teardown也不能泄漏cache；后续Trace从已先行提交的durable evidence读取。live state仍是memory-only，不能从durable evidence反向构造。

runtime input draft正文不写入events/artifact。`runner_input_requested`只记录invocationId、inputRevision、hasDefaultText与promptChars；`runner_input_submitted`只记录invocationId、inputRevision与chars。两者都不得出现prompt、defaultText、draft或value正文。
## Trace

Trace只读且最多展示当前retained event window。`run_completed`、`run_failed`、`run_stopped`分别派生completed、failed、stopped；存在`run_started`但summary未记录终态时派生interrupted。Trace可跨server restart查看，但不能成为routing、Resume或runtime hydration输入。

旧的“全部matching run + 每个完整event tail”聚合response已删除。`GET /api/rooms/:roomId/runner/traces`按opaque cursor返回最多50项run summary；选择run后，`GET /api/rooms/:roomId/runner/traces/:runId/events`再按opaque run-bound cursor返回最多200项event和window metadata。server维护可atomic更新、可从manifest cold rebuild的derived room/run index；共享root writer固定以`.locks/log-storage-gc.lock → .locks/trace-index.lock`串行admission、重新读盘、merge或rebuild并atomic replace，已加载reader以file generation发现外部替换。已知manifest add/remove只merge entry并比较ID集合，不解析既有manifest；缺失、损坏或无关集合漂移才cold rebuild，GC后rebuild只能消费剩余manifest。每个process/run首次从summary或event endpoint进入cold Trace时都读取首尾segment验证并修复stale valid summary；成功checkpoint/verification后summary page只读index和该页summary，warm event page只读覆盖该页的segments，同进程append使freshness marker失效。越过tail cursor返回`invalid_trace_event_cursor`。UI只在进入Trace view时请求summary，并分别对summary与selected-run events分页，不在Room mount预取，也不一次下载或创建全部历史DOM；selected current run终态后继续显示runner retained window，不退回旧persisted page。已被quota GC删除的whole run不再出现在Trace，不能恢复。
