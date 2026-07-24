# 执行计划

## 阶段一：确定性pure primitives与Macro热路径

先增加shared canonical SHA-256 projection、Text single-replacement diff/apply、visible line window和paged cursor等pure primitives及unit tests。随后把Macro validator改为一次trusted traversal双结果，把record session接入50ms diagnostics scheduler与hard-action flush，并用path mutation journal替换full stringify dirty。artifact choices改为一次structural DFS index。

本阶段不改变Macro schema、validation issue contract或唯一rune draft ownership。JSON/persistence/Start snapshot等trust boundary clone保留。

## 阶段二：AgentEvent与Room transport

把AgentEvent store改成per-log cold cache、event ID/terminal-launch/capture-key index与version waiter；append只在创建JSONL entry时fsync parent。capture等待改为event notification加轻量100ms checkpoint heartbeat。

让terminal index map在client端authoritative删除closed terminal，移除move/close后的room snapshot；Prepare coalesce中间index map。Room broadcast预编码一次，WebSocket queue改head-index/cached-byte deque。先用unit/integration冻结message order、durability和multi-client payload次数。

## 阶段三：Text incremental protocol

直接替换旧Text client/server message，server runtime缓存content hash并atomic校验patch/replace。前端建立per-terminal leading/trailing throttle、single-flight/latest coalescing和serialized observer merge；revision/hash mismatch通过single-flight full text snapshot修复。

Workspace提供pending Text flush registry，blur/tab切换/Start/依赖Text replay的hard boundary等待ack。TextBox和Macro textarea共用visible line window，保持textarea本身即时输入、caret和既有高度行为。

## 阶段四：Runner与Trace

Runner full snapshot加入definition/state hash；publication跟踪last published revision/run identity，普通delta只投影mutable state和新增events。client merge后异步验证state hash再install，失败复用repair coordinator。terminal publication后释放live event cache。

增加derived run index、run summary cursor page和segment-bounded event page，删除aggregate Trace API；更新Macro runner client/session与Trace UI的选中run、next/previous cursor stack。保留1000-event durable tail和全部completed run。

post-review收口时，Text projection为每次full projection建立monotonic token并在异步hash后复核current identity。Runner把Start clone直接deep-freeze为live/full-snapshot projection。Trace valid summary走零segment fast path，event page按sequence直接定位segment；derived index以cross-process lock执行fresh merge并以atomic file generation使已加载reader失效。selected current run在终态继续使用live retained window，越过tail cursor稳定拒绝。

后续审阅继续收紧同一contract：每个run/process的cold Trace首次访问先验证并修复stale valid summary，再建立可由append失效的fast-path marker；index writer对已知增删只merge entry与比较ID集合，不解析全量manifest；dirty recording Proxy在set边界递归unwrap，反复splice/move保持原node identity。

## 阶段五：审阅、Current Docs与完整Gate

补large fixture work-count、payload shape、cold-load/index、Unicode patch、repair、pagination、DOM bound和deque回归；逐项核对Legacy Kill List没有dual protocol。同步`macro_template_contract.md`、`capture_agent_event_contract.md`、`room_terminal_contract.md`、`run_log_contract.md`、`shell_deck_architecture.md`和Quickstart。

执行implementation pre-review、focused Gate、AI post-review，再顺序运行`just check`、build、unit、integration、Chromium E2E、file-size与diff-check。最后写`04_review`、更新index状态并确认当前jj change `conflict=false`。

## 主要文件映射

Macro validation/dirty落在`macroDefinitionValidation.ts`、`macroDraftMutation.ts`、`macroDiagnosticsScheduler.ts`与唯一`macroRecordSession.svelte.ts` owner；AgentEvent落在`agentEventStore.ts`和`macroAgentCapture.ts`。Text protocol由`protocol.ts`、`textTerminalMutation.ts`、server terminal coordinator、browser projection/write state与`TextBoxSlot.svelte`共同承担。Room结构projection和single encode由terminal snapshot、broadcast与WebSocket queue模块承担。Runner/Trace分别收口到publication/hash/merge/repair与run store/trace index/client session/UI。

新增职责模块同样受400行Gate约束；public facade继续只做组合和路由，不把拆出的算法重新堆回manager、runner service或MacroPanel。

## Legacy Kill List

收尾扫描并删除：`set_terminal_text`与full-body Text success snapshot；Runner delta中的definition/runningMacro及HTTP full runner response；aggregate Trace response/helper；move/close后的room snapshot；AgentEvent append/wait反复读盘；per-node root artifact DFS；总行数等量gutter DOM；WebSocket queue `shift()`与出队重复byte-length计算。旧字段、旧helper、旧fixture或dual parser不得保留为兼容路径。

## 验收停止线

代码与正式spec逐条映射，旧协议/聚合路径完全删除，确定性work-count和行为测试通过，完整串行Gate无warning/error，所有source不超过400行且P1/P2为零时结束。进一步的总磁盘retention、几十MiB Text chunk hash、OT/CRDT、自定义Worker、Trace全文搜索或通用performance framework不扩大本任务。
