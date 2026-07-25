# AI Pre-review

## 总体判断

本轮同时预审task文档与现有storage ownership。方案只增加一个quota owner和一个AgentEvent segment owner；run真值继续由MacroRunStore/EvidenceStore持有，AgentEvent indexes/waiters继续只有AgentEventStore持有，没有建立第二份runtime state或通用retention framework，可以进入实现。

## Gate 结论

Formal Document与Execution Gate通过。计量范围、删除单位、protected truth、跨进程lock、90%水位、trigger、fail-loud和current-schema-only边界均已冻结。

## Findings and Solutions

### 1. P2 / L1：不能把terminalized等同于summary文件当前内容

summary可能因maintenance failure暂时stale；若GC直接读取它，会把已经terminalized的run永久视为interrupted。实现必须经EvidenceStore cold freshness truth取得terminal kind。

### 2. P2 / L1：run目录不能边枚举边逐文件删除

Trace或另一process可能观察半个run。实现必须先在同一filesystem atomic rename完整目录，再更新derived index并删除tombstone。

### 3. P2 / L1：AgentEvent最后一个segment没有天然closed truth

只看mtime会误删仍被另一个server process追加的文件。实现必须以`.open.jsonl`/`.jsonl`文件名状态作为persistent truth；crash遗留open宁可阻断quota也不能猜测删除。

### 4. P1 / L1：terminal cursor eviction不等于Room current-run release

terminal snapshot发布后可以淘汰event cursor/window cache，但MacroRunnerLifecycle仍持有用于HTTP/WS snapshot的terminalized `LiveRun`。实现必须提供跨process current-run pin，直到next Start replacement或Room Destroy，不能让GC删除仍被Room引用的evidence。

### 5. P2 / L1：admission与publish不能分成两个lock phase

只在scan时持有GC lock会让两个process从同一usage baseline分别通过并共同越界。manifest、artifact、run event/summary与AgentEvent line必须让同一lock覆盖fresh scan到durable publish，并用双process barrier冻结。

## 需要人工拍板

无。用户已明确默认2 GiB、90%水位、whole-run cleanup、AgentEvent rolling segment及暂不提供age/count/pin/export。

## AI 可直接修

以上三项都由当前contract直接决定，进入本change实现与测试。

## 未覆盖与残余风险

单个超大event、Macro node/regex、HTTP/WS payload等resource envelope不在本任务。crash遗留open AgentEvent segment不会自动判死，反复异常退出可能提前触发limit；这是保护live跨进程writer的有意fail-closed结果，不通过timeout猜测修复。

## 审阅范围

已核对User Data Root、EvidenceStore/segment storage、MacroRunStore/Trace index、runner terminalization/artifact、AgentEvent index/ingest、server startup/stop、现有retention tests与400行Gate。
