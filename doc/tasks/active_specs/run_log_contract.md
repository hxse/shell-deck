# Macro Run Evidence Contract

## Durable evidence

每次成功启动都在 User Data Root 的 `runs/<runId>/` 建立 current-schema-only evidence：

* `manifest.json` 保存 `RunManifestV1`，包含frozen runnable MacroDefinitionV5、canonical SHA-256 definition hash、MacroRecord id/revision、serverInstanceId、roomId、roomGeneration、terminalStructureRevision及frozen index/type/terminalId/launchId bindings。persistable但含unassigned的definition不能Start，因此不会产生manifest或`run_started`。
* `events/` 按100条一个segment保存最近的durable event tail；文件名是segment首个绝对`eventSeq`。每个event包含immutable Room provenance、monotonic absolute eventSeq、generated eventId、kind、timestamp与data。
* V0固定最多保留最近1000条event，不提供配置。跨过上限时只删除最旧完整segment，因此steady retained window为901至1000条；旧event永久删除，不提供历史分页。
* `summary.json`永久保留run开始/更新时间、firstAvailableEventSeq、lastEventSeq、totalEventCount、discardedEventCount与lastEventKind。eventSeq不因retention重新编号，Trace必须明确显示已删除数量。
* artifact先以private atomic file写入，再追加`artifact_created` event。event retention不删除artifact；artifact只随整个run evidence被显式清理。
* complete JSONL line已经写入但file/directory fsync或summary checkpoint报告不确定时，append按相同event intent与绝对sequence检查authoritative tail并幂等收口，不能追加第二个同序号event。crash留下的partial final line在下一次read/append前截断。
* live run在内存维护provenance、next event sequence与bounded event window；正常append只写新增event，不读取完整segment或完整run。`summary.json`在run开始、segment边界、retention推进和终态checkpoint，冷读可从首尾segment修复stale summary。

production ownership保持单向：`EvidenceStore`是run evidence唯一public facade以及append cursor/maintenance debt owner；internal segment storage只执行JSONL append/recover/read/prune，record validation只执行current exact codec与intent equality。其他production consumer不得直接import这两个internal module或绕过Store写evidence。

Start按manifest publish → `run_started` append → 无await安装in-memory run的顺序提交。任一阶段失败都不能伪装成已启动；Destroy会关闭Room admission并使在途Start在await后复核generation/lifecycle，不能在已销毁Room中重新安装run。

## Runtime-only state

runner cursor、run snapshot、Pause/Resume waiters、pending input、frozen routing map与active structure lock都只存在于当前server process。Pause/Resume是同一live run中的精确运行时暂停/恢复；server restart、Room Destroy或generation变化后返回`run_not_active`，绝不从manifest、event、artifact或Trace恢复runner。

Running、Paused、Waiting input与Stopping期间，Room terminal structure由active-run lock冻结；lock acquire与release都是authoritative Room state change并推进roomRevision。Room Home的generation-bound Destroy仍可用，并会停止run、记录终态或留下可解释的interrupted evidence。

runner必须在tight loop内定期让出macrotask并在yield后复核abort/pause。Input submit的durable event先于pending resolver清除和Running状态发布；append失败保持waiting input可重试。每个run最多一个terminal event，终态后不得继续追加step event。

live runtime通过Room WebSocket同步：connect/reconnect或gap repair发送包含bounded event tail的authoritative `runner_snapshot`，正常transition只发送最新state与newly appended events的monotonic `runner_delta`。`runtimeRevision`只在当前Room generation内单调，event按absolute eventSeq合并；gap必须以generation-bound single-flight读取完整snapshot，不能猜测。一次transient失败不会放弃repair：每批最多三次（立即、100ms、300ms），耗尽后保留pending，仅由focus、reconnect或后续runner message继续，绝不恢复周期polling。关闭全部browser不停止run，晚到browser立即取得当前snapshot。live state仍是memory-only，不能从durable evidence反向构造。

runtime input draft正文不写入events/artifact。`runner_input_requested`只记录invocationId、inputRevision、hasDefaultText与promptChars；`runner_input_submitted`只记录invocationId、inputRevision与chars。两者都不得出现prompt、defaultText、draft或value正文。
## Trace

Trace只读且最多展示当前retained event window。`run_completed`、`run_failed`、`run_stopped`分别派生completed、failed、stopped；存在`run_started`但summary未记录终态时派生interrupted。Trace可跨server restart查看，但不能成为routing、Resume或runtime hydration输入。
