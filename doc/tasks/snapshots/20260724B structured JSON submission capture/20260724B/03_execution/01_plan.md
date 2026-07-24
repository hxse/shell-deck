# 执行计划

## 阶段一：类型与validator

新增共享JSON value/schema、typed artifact source和`JsonMatchCondition`。扩展Capture exact union、terminal capability、artifact choice与root/Parallel边界；接入JSON Schema 2020-12 validator和JSON Pointer validator。

先补unit测试，证明合法definition、schema-aware local reference traversal、invalid schema、artifact type、textual projection、pointer和matcher规则，再进入runtime。`$ref`作为property/map key或instance data不得误判，只有真正subschema位置的remote reference失败。

## 阶段二：runner与ingest

新增职责单一的structured Capture waiter和JSON submission ingest模块。`MacroRunnerService`只增加facade方法，lifecycle仍唯一拥有run map；如主文件接近400行，优先把artifact persistence搬到专用模块，不在facade继续堆逻辑。

增加`POST /api/rooms/:roomId/structured-results`、per-terminal submit URL env、canonical `SHELL_DECK_JUSTFILE`与stdin CLI。复用现有memory-only ingest token、Room ticket和terminal launch membership，不新增端口或identity参数。route固定token、exact body、path/membership的验证顺序，并把malformed path归一为membership mismatch。

integration测试从两个真实live Room证明正确提交、cross-Room拒绝、schema重试、一次消费及lifecycle。

## 阶段三：Visual authoring与If

Capture editor增加root-only structured kind、schema JSON编辑和waitLimit；parse-valid但compile-invalid的raw文本与parse失败文本同样逐字保留。Schema字段复用普通multiline高度策略，并从合法Schema生成可查看、可手动选择且可一键复制的建议提示词，clipboard失败不能隐藏正文，命令只引用注入的`SHELL_DECK_JUSTFILE`。If editor增加text/json condition切换、typed scalar matcher和JSON Pointer。全部正式textual consumer展示`captured_json`并共用read-boundary projection，typed JSON consumer仍按family过滤；Parallel palette不展示structured kind，final Output保持lane-local text-only。

更新current control inventory和focused Playwright，保持既有DOM层级、control order和theme组件语言，只增加本功能必需控件。

## 阶段四：Current Docs与收口

同步`macro_template_contract.md`、`capture_agent_event_contract.md`、`run_log_contract.md`、`shell_deck_architecture.md`和Quickstart；新增task-scoped just recipe与package入口。

执行AI post-review、旧痕迹扫描和完整串行Gate，最后写`04_review`及`doc/tasks/index/052_20260724B.md`。

## Legacy Kill List

本任务不删除现有Capture或condition分支。需要清理的是实现中出现的任何临时step token、manual Room参数、独立端口、持久化或缓存的stringified-JSON fallback、structured Capture的`captured_text`双写、每个consumer各自实现的JSON序列化，以及未进入正式justfile的临时脚本入口。正式的统一read-boundary canonical projection不是legacy fallback。

## 验收停止线

P1/P2为零；focused和完整Gate无warning/error；所有新增source不超过400行；current docs、guide、task spec、代码与测试一致。Codex在线行为、恶意本机进程隔离、跨restart submission恢复和远端schema registry明确不进入本任务。
