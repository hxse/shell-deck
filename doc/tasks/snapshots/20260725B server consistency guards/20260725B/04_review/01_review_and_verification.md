# 20260725B Review and Verification

## 总体判断

本轮同时审阅代码和文档。五项已冻结的一致性缺口均已修复：Trace direct event page共享cold freshness repair、WebSocket registration在任何副作用前绑定upgrade generation且能精确回滚、content edit lease在post-publish授权失败时只回滚本次published truth、Trace index统一使用`.locks/`，file-size Gate在400行hard limit前提供350行non-blocking advisory。未改变公开protocol payload、schema、UI或既有成功路径；范围内未发现未解决P1/P2/P3，Formal Document、Code、Test、Current Docs与Close Gate通过。

## Gate 结论

| Gate | 结果 |
| --- | --- |
| `just test-20260725b` | 23项focused unit/source oracle + 8项focused integration通过 |
| `just check` | 通过；348个project-authored code文件无hard issue、13项预期advisory；TypeScript通过，Svelte 0 error / 0 warning |
| Production build | 通过；403 modules |
| Full unit入口 | 6项theme foundation + 267项core unit + 55项integration通过 |
| Integration独立入口 | 55项通过 |
| Full Chromium E2E | 59项通过，单worker |
| Project file-size | 348个project-authored code文件全部不超过400行，0 exception |
| Diff check | 通过 |
| jj conflict | `krwutlyt`为`conflict=false` |

## Findings and Solutions

### 1. P2 / L1：Trace direct event endpoint绕过cold freshness repair

`EvidenceStore.page()`原来直接信任schema合法的`summary.json`。普通event只按checkpoint节奏更新summary，因此进程退出后直接访问events endpoint可能隐藏已经durable的event。

现让`page()`先进入与`traceSummary()`相同的per-run freshness gate。cold请求验证首尾segment并按authoritative tail修复summary；成功后安装marker，warm page恢复只读取summary和覆盖请求范围的segment。测试同时冻结首次cold recovery和随后range-only I/O。

### 2. P2 / L1：WebSocket generation校验发生在client注册之后

旧socket可以在upgrade后、open前跨越Room destroy/recreate。原实现先向current generation登记client并尝试分配controller，再比较旧generation，可能短暂取得新Room控制权并留下ghost state。

现把upgrade冻结的generation贯穿transport、manager、control facade与presence owner，在client ID分配、registry写入、message或controller transition之前比较。fresh-first-client的controller transition返回exact identity rollback；`room_control`或`room_snapshot`发送失败都会同步删除client并只撤销本次transition，下一个合法client仍得到epoch 1。

### 3. P2 / L1：content lease post-publish授权失败会留下untracked held lease

Acquire/takeover原来先publish held state，再执行controller authorization，最后才登记process ownership。授权在中间丢失时，失败请求留下最长持续到TTL的持久化lease。

现让两条路径共享post-publish authorize/track阶段。授权失败会等待同一record transaction，并只在current held state的全部持久化字段仍与本次published state相同时写回同epoch available；并发出现的不同owner/epoch truth保持不变。成功rollback继续通过既有`onChanged`发布available view，失败请求不加入owned map。

### 4. P3 / L1：Trace index lock目录偏离canonical storage layout

Trace index原来使用`<User Data Root>/locks/trace-index.lock`，而统一path truth是`.locks/`。现从`userDataPaths()`取得canonical locks directory，唯一lock为`.locks/trace-index.lock`；focused测试同时断言旧`locks/`目录不出现。

### 5. P3 / L1：400行Gate缺少提前信号

scanner原来只有超过400行才失败，接近上限的文件无法在日常Gate中提前暴露。现增加350–400行inclusive advisory集合和稳定CLI格式；349/350/400/401四个边界均有测试。Advisory不改变退出码、不冒充compiler warning，也没有任何path exception。

## 需要人工拍板

浏览器exact-origin/Host/session proof、统一resource envelope和retention policy仍需要单独冻结产品与安全contract，按用户决定不在本任务实现。

## AI 可直接修

审阅提出的五项direct fix均已完成并通过完整验证，没有遗留AI可直接修项目。

## 未覆盖与残余风险

本任务没有处理HTTP/WS/Macro/regex容量上限、run/artifact/AgentEvent自动清理、同步append/fsync批处理或现有near-limit文件拆分。`just check`当前报告13个350–400行advisory，其中最高为400行；它们不阻断本change，但后续修改应优先在突破hard limit前拆分。没有用户可见流程变化，因此Quickstart正文无需新增行为说明；相关current contract已同步到四份active spec。

## 审阅范围

审阅`krwutlyt`相对父change `qtqkpyrt`的全部代码、task文档、active spec、focused/default测试发现、file-size scanner与CLI输出。确认未改变HTTP/WS payload、Macro schema、controller takeover、lease TTL/epoch、Trace cursor/retention、UI、test id或400行hard limit；验证命令严格串行执行。
