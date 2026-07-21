# 20260627A.038 Review Result

## 当前状态

implementation-complete，Document/Code/Test Gate通过。

## Schema与UI

* 唯一current definition破坏性切换为`MacroDefinitionV5`与`schemaVersion:5`。AgentEvent Capture必须携带exact `waitLimit`：`{kind:"unbounded"}`或`{kind:"timeout",timeoutMs}`；V4、missing、`null`、boolean、非法duration以及其他Capture kind携带该字段均fail loudly，不存在reader、migration、alias或fallback。
* root与Parallel lane visual editor新增`Enable timeout`。两处使用同一专用wait-limit行，checkbox固定14×14、零padding并与文字中心对齐，hint/duration稳定占第二列，不再继承普通text input尺寸或通用macro-row排版。新建或切换到AgentEvent时固定生成unbounded；勾选后原子切为默认600000 ms的timeout branch，取消后删除duration payload。JSON editor与Library Macro JSON继续只走唯一V5 text gateway，不自动补字段。
* V5 hard cut的saved-content isolation已在Macro与Library Macro JSON统一：invalid LibraryItem envelope或invalid Macro definition不进入Library selector，list返回`itemId/error` diagnostic并由UI明确显示；direct read/load继续fail loudly。Prompt/Note不经过Macro validator，不存在V4 reader、normalizer或自动迁移路径。
* `.031A`历史source constants保持不变。current source inventory由195变为199，新增4个AgentEvent timeout controls明确归属`.038`；它们按既有约定不进入non-Codex comprehensive journey，而由独立、完全离线的`.038` UI journey覆盖。

## Runner

* 删除隐藏的`SHELL_DECK_AGENT_EVENT_CAPTURE_TIMEOUT_MS`、固定10分钟fallback与`agent_event_not_ready`终态。unbounded使用有界100 ms abortable polling，不busy-loop，直到匹配结果、Stop/Destroy、frozen launch丢失、server restart或matching hook error。
* timeout按单调时钟计算active waiting time。runner记录累计Pause时长；即使Pause与Resume都发生在同一个polling slice内，也不会把暂停时间计入deadline。Stop继续通过现有AbortSignal立即取消并释放structure lock。
* Start同时冻结目标output/prompt和`agent.error` baseline。baseline后的matching error稳定失败为`agent_event_hook_error:<terminalId>`；显式到期为`agent_event_capture_timeout:<terminalId>`。迟到output只保留为evidence，不复活终态run，也不会越过下一次Start的baseline。

## Gate

* `just check`：通过，TypeScript与Svelte均为0 errors、0 warnings。
* `just build`：通过，188 modules；app 263.25 kB、xterm 329.30 kB、Svelte 38.00 kB、short-uuid 4.90 kB，所有chunk低于500 kB，0 warning。
* core unit：151 pass，0 fail；其中V5 exact wait-limit覆盖unbounded/timeout、V4、missing、extra、null/boolean、zero/negative/fraction/infinite及非AgentEvent额外字段；LibraryStore scan新增malformed-record isolation覆盖。
* integration：53 pass，0 fail；`.038`新增5项确定性runner测试，覆盖unbounded成功与Stop、显式timeout与迟到event baseline、长Pause、同一polling slice内短Pause/Resume、matching hook error。测试使用fake terminal与本地AgentEvent ingest，不运行真实Codex。
* full Playwright E2E：49 pass；新增root/Parallel AgentEvent visual/JSON journey以及Library invalid Macro item isolation journey，验证默认unbounded、checkbox、duration编辑、取消后的exact branch与invalid item不进入selector，同时`.032-.037`既有Room/Macro/Library/runtime journeys全部通过。
* `just test-031b`：12个inventory assertions与13条Chromium current journeys通过；复杂Macro、Room和Library交互没有非预期漂移。
* `git diff --check`、current-schema residue scan通过；production中不存在V4 validator/type、hidden timeout env、`agent_event_not_ready`或missing-waitLimit fallback。

## Findings

* P1：0。
* P2：0。
* P3：0。

## Active spec同步

`macro_template_contract.md`、`capture_agent_event_contract.md`、Library、run log、user data storage、architecture、active-spec index、README与quickstart均已切换到V5 current truth。后续`20260721A`纯拆分任务必须原样保留本任务行为。
