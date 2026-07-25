# 20260725C Review and Verification

## 总体判断

最终审阅覆盖代码、跨process storage boundary与正式文档。范围内finding均已修复：live Room仍引用的terminalized run由跨process pin保护；quota lock覆盖fresh scan到durable publish；manifest、Trace index、artifact、run event/summary与AgentEvent line全部进入atomic admission；closed AgentEvent mtime表达真实close time；present empty/whitespace environment明确失败；极大合法limit的90% target保持整数精确。

原任务的默认2 GiB、90%目标水位、oldest terminalized whole-run优先、closed AgentEvent segment后继清理、current-schema-only layout和fail-loud protected boundary继续成立。范围内未发现未解决P1/P2/P3；Formal Document、Code、Test、Current Docs与Close Gate通过。

## Gate 结论

| Gate | 结果 |
| --- | --- |
| `just test-20260725c` | 30项focused unit/source oracle + 14项focused integration通过；各文件严格串行 |
| `just check` | 通过；353个project-authored code文件无hard issue、15项advisory；TypeScript通过，Svelte 0 error / 0 warning |
| Production build | 通过；403 modules |
| Full unit入口 | 6项theme foundation + 267项core unit + 7项quota unit + 57项integration通过 |
| Integration独立入口 | 57项通过 |
| Full Chromium E2E | 59项通过，单worker，3.0分钟 |
| Project file-size | 353个project-authored code文件全部不超过400行，0 exception |
| Diff check | 通过 |
| jj conflict | `qxpqosnu`为`conflict=false` |

## Findings and Solutions

### 1. P1 / L1：GC可以删除仍被current Room snapshot引用的terminalized run

terminal publication原来在释放event cursor/window后立即触发GC；MacroRunnerLifecycle仍保留同一个terminalized `LiveRun`，后续direct snapshot、HTTP runner GET和WebSocket reconnect却需要重新读取已经可能被删除的evidence。

现由MacroRunStore在run进入Room current map前安装`.locks/log-storage-current-runs/<runId>.json`。pin冻结owner PID与Linux process start time，并由同一个GC lock验证：live pin对所有共享root的server process可见；next Start先pin replacement再移除旧pin，Room Destroy才移除current pin，crash stale pin由后继GC清理。event cache仍可在terminal publication后淘汰，不再兼任retention truth。

integration以exact low-limit GC证明completed run继续支持direct snapshot、HTTP GET与late WebSocket `runner_snapshot`；第二次Start后只回收旧run，Destroy后才回收replacement。

### 2. P2 / L1：quota admission与durable publish之间存在跨process窗口

旧`enforce(incomingBytes)`在scan后释放lock，manifest、artifact或AgentEvent随后才写入。两个process可以从同一usage baseline分别通过，并共同超过limit。

现统一使用`admitAndPublish(incomingBytes, publish)`，让`.locks/log-storage-gc.lock`覆盖fresh usage、candidate cleanup、admission和完整同步publish。内部summary checkpoint在同一operation中使用reentrant admission，避免重复取得同一lock。双Bun-process barrier测试冻结`limit=1000`、两个600-byte writer只有一个成功，最终usage为600。

### 3. P2 / L1：run event append绕过quota

EvidenceStore现在在event ID/timestamp确定后计算完整JSONL line bytes，并加上可能summary checkpoint的完整保守上界，再进入MacroRunStore提供的atomic admission。普通、terminal与maintenance event使用同一路径；失败不能写line或推进cursor。manifest先admit自身exact bytes，随后在同一个quota transaction中动态admit Trace index实际positive growth；artifact使用exact UTF-8 bytes。

AgentEvent也从“只在segment creation/rotation检查”改为每条line atomic admission；既有`.open.jsonl`不能在limit之后继续增长。focused测试在protected bytes填满limit时分别冻结manifest、run event、artifact与AgentEvent均以`log_storage_limit_reached`失败且零新增evidence。

### 4. P3 / L1：closed AgentEvent排序使用last-write time而不是close time

rename不会更新mtime，长时间open但刚关闭的segment可能被错误排到最旧。close现在先在仍受`.open.jsonl`保护的filename上写入当前timestamp，fsync file metadata，再atomic rename并fsync parent directory。GC继续按mtime排序，但该mtime现在是持久化close time；回归先把open mtime改为旧值，再证明close后mtime被推进。

### 5. P3 / L1：present empty environment错误回退默认值

解析现在先区分property缺失与property存在。只有`SHELL_DECK_LOG_STORAGE_LIMIT_BYTES === undefined`回退2 GiB；empty、whitespace、`0`、negative、fraction与non-number全部稳定返回`invalid_log_storage_limit_bytes`。

### 6. P2 / L1：stale summary的sequence相同仍可能隐藏terminal truth

前次最终审查已修复的freshness逻辑继续保留：first/last sequence相同仍必须核对terminal kind、updated timestamp、count/discard metadata与Room provenance。schema-valid但`lastEventKind` stale的summary会从authoritative首尾segment恢复，GC不会永久漏掉可回收completed run。

### 7. P3 / L1：重复terminal release与focused test资源竞争

`releaseLiveRun()`只有实际释放cursor/window/current Room pin时才触发terminal sweep，重复publication保持no-op。focused recipe继续逐文件串行运行，没有通过放宽timeout掩盖1000-event fsync测试与Evidence/retention测试的资源竞争。

### 8. P2 / L1：Trace index cold rebuild绕过quota

Trace index缺失、损坏或出现无关manifest集合漂移时，旧实现只持有trace lock并直接atomic replace；固定manifest entry预留无法覆盖完整cold rebuild，因此Trace read本身可能写穿limit。

MacroRunTraceIndex现在把known mutation与cold rebuild全部交给dynamic quota admission。admission先取得quota lock，再在trace lock内计算新index相对当前文件的positive growth；如果GC删除了run，重新从post-GC manifest集合计算，直到不再删除run才发布。known remove遇到missing/corrupt index只invalidate，不在GC递归路径偷偷触发full rebuild。focused回归分别证明GC后index不含已删run，以及无候选时返回`log_storage_limit_reached`且不创建index。

### 9. P3 / L1：极大合法limit的90% target有浮点误差

旧表达式先计算`limit * 9`，对接近`Number.MAX_SAFE_INTEGER`的合法值会让中间结果失去1 byte精度。现在先计算`quotient = floor(limit / 10)`与remainder，再组合`quotient * 9 + floor(remainder * 9 / 10)`；回归冻结`9007199254740988 → 8106479329266889`。

## 需要人工拍板

无。全部finding均由已冻结contract直接决定；current-run internal pin不是用户可配置的保留策略。

## AI 可直接修

外部审阅提出的P1/P2/P3已全部完成并通过完整验证，没有遗留AI可直接修项目。

## 未覆盖与残余风险

本任务约束durable disk logs，不提供AgentEvent in-memory index eviction，也不处理HTTP/WS/Macro/regex resource envelope。atomic admission有意让多个server process的durable log publish在同一同步lock上串行；这是当前correctness优先的选择，后续若要提高高频写吞吐，应另立task设计同锁保护的reservation，不能重新打开scan/publish窗口。

active/interrupted run、live current-run pin与crash遗留open AgentEvent segment可能占满quota并阻断后续写入；这是保护不可安全删除truth的预期fail-closed结果。本任务不按年龄或数量清理、不提供用户pin、export或undelete，也不迁移旧flat AgentEvent logs。MacroRecord与notification config始终不参与quota。

## 审阅范围

审阅`qxpqosnu`相对父change `krwutlyt`的全部代码、task文档、active spec、Quickstart、focused/default测试发现、User Data Root layout、GC/admission lock、run current ownership、Trace snapshot、AgentEvent ingest/close、startup/stop与400行Gate。确认未改变Macro schema、Trace HTTP payload、runner/AgentEvent protocol、UI、test id或MacroRecord persistence；验证命令严格串行执行，唯一并发行为是integration内部为验证cross-process exclusion而启动的双worker barrier。
