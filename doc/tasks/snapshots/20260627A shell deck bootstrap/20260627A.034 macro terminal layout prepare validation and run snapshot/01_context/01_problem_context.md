# 20260627A.034 Problem Context

## Portable definition、record与runtime必须分开

现有Macro把terminal id、alias或config-scoped target写入模板，使模板只能在创建它的runtime中可靠工作。terminal又允许创建、插入、删除和拖拽；静态index与稳定id混用后，Action容易发到错误对象。

MacroDefinitionV3只表达用户可移植编排：

    {
      schemaVersion: 3,
      name,
      description,
      terminalLayout: [
        { index: 1, type: shell },
        { index: 2, type: text }
      ],
      body
    }

MacroRecord由.032持久层提供id、revision和timestamps；live Room terminal则拥有terminalId、launchId、readiness、process与cwd。这三层的identity和validation目的不同，不能互相抄字段。Macro editor JSON、Library macro-template content与clipboard Copy都只处理definition，不伪造record metadata。

## Save与Start是不同问题

Save回答“这是不是一个合法、可移植的MacroDefinitionV3”；Start回答“调用者看到的这个saved revision，能否在当前Room、当前terminal结构上安全运行”。如果Save依赖当前Room，用户必须先手动准备terminal才能保存一个纯模板，破坏Library/portable使用方式。

因此Save只调用统一definition/Flow validator并提交record，不读取Room snapshot、不触发Prepare。terminal mismatch/not-ready只影响当前Room的readiness和Start。Start必须重新读取指定record revision与terminalStructureRevision、在锁内解析index到ID并冻结完整definition。dirty draft点击Start时仍然先Save/Create，但Save response导致的fresh revision、fresh record identity与Edit session lease保留是compound operation的预期phase transition；New Create后必须取得fresh record lease才继续可编辑。不能把这些预期变化当成外部stale response，也不能放松对真正draft/controller变化的检查。

run structure lock只冻结Room terminal结构，不是Macro content edit lock。Completed/Failed/Stopped终态必须释放structure lock；Macro是否可编辑只取决于用户进入Start前是否处于Edit session。Save或dirty Start不得无故退出该session，否则终态后整个visual editor会看似仍被runner锁住。

## Editor并发与版本

.033保证一个saved Macro record同时最多一个editor，但lease不能代替revision。editor状态必须显式区分：

    selectedRecord
    baseRecordRevision
    draftDefinition
    draftRevision
    dirty
    editLeaseId

saved Macro默认read-only；Edit成功取得lease后才能修改visual/JSON draft。New是client-local draft，在Create成功前没有record id或existing-record lease。Save/Delete携带lease与expected revision；每个await后的commit都复核operation generation、record id/revision、draftRevision、Room controller与edit lease，旧response不能覆盖新编辑。

## index/type与terminalId

live Room保存ordered terminal objects。terminalId和type跟随对象，index由对象当前UI位置实时导出；拖拽或插入后index立即变化，terminalId不变。后台不维护一套可能漂移的第二identity map。

Prepare和Start读取调用者看到的terminalStructureRevision。Start在structure lock内按index找到terminalId、复核type/readiness并一次冻结。后续Action只按frozen Room generation + terminalId发送，绝不在Action执行时重新查询live index，也绝不从MacroRecord读取可能更新后的body。

terminalStructureRevision只表示index到terminalId/type/launchId binding变化；starting/ready/exited/failed不改变binding，因此只广播readiness并触发validation，不递增structure revision。Start仍在锁内读取最新readiness，故无需用一个会让忽略readiness的Prepare产生伪冲突的revision保证安全。

## Prepare只属于显式Macro操作

新Room不选择Macro。选择/切换Macro、.036 clean Load后的自动选择、New、Save、reload、remote refresh、terminal变化与Start都只更新client/editor或validation，绝不Prepare。Settings不保存开关。

Macro运行控制区在Start左侧提供`Prepare terminals`文字按钮。它读取当前正在显示的draft terminalLayout：New、dirty、saved/read-only都可使用；JSON Edit使用当前buffer，不能回退到last-valid value。只要JSON可解析且terminalLayout自身合法即可Prepare，Flow body其他错误仍可阻止Save/Start但不阻止这个layout-only operation。Prepare期间当前draft、JSON buffer、selector和相关operation全程inert，避免请求快照漂移或多个Prepare重叠。用户手动删除、拖拽或restart terminal后，系统只重新校验、标红和禁用Start，直到用户再次点击按钮或手工修复。

## Readiness与用户责任

Prepare只保证前N个位置的type结构。它不等待starting terminal，不restart exited/failed terminal，也不为了readiness创建替代对象。新建Shell可能先处于starting；后续lifecycle event再变为ready。真实backend create/move中途失败属于低频可见错误：resolver立即停止并返回最新authoritative snapshot，已经完成的调整保留，不做staging或复杂rollback；UI重新validation并禁用Start，用户自行调整。

Room内terminal数量和terminalLayout长度不设人为上限。显式Prepare按request layout顺序执行；若真实系统资源不足，沿用同一个backend failure/partial-state contract，不增加terminal_capacity_reached或固定MAX_TERMINALS_PER_ROOM。

用户负责让terminal进入ready并让Shell位于所需cwd。shell-deck负责持续显示不一致、阻止错误Start，以及运行后不把输入投向另一terminal。

## Run snapshot与只读证据

只冻结terminal mapping仍不够：如果run在每个step读取live MacroRecord，另一个Room随后更新同一record，当前run会在中途切换程序。因此Start必须冻结完整validated MacroDefinitionV3、record revision、Room generation、terminalStructureRevision及index/type/id/launch mapping。

runner cursor、definition snapshot与terminal snapshot只存在于live Room runtime。append-only run event log是唯一lifecycle truth；只读run manifest是run_started引用的immutable attachment，保存完整canonical definition、hash和mapping用于Trace，但不独立声明run已启动，更绝不用于Resume。server restart、Room Destroy或generation变化后旧run只能显示interrupted。

Prepare/Start从入口到最后publish都持有.032 generation-bound lifecycle ticket。Destroy先关闭admission并abort/drain这些ticket；PTY spawn、manifest fsync或event append返回后必须再次确认active，保证销毁后的Room不会被异步结果重新插入terminal或安装run。

## Active run、controller与Destroy

Starting、Running、Paused、Stopping期间terminal create/delete/reorder/reset/restart与显式Prepare都冻结。Pause不释放锁，因为frozen snapshot仍被run使用。

.033的Room controller仍覆盖Room内browser mutation；structure lock和controller是两个不同gate。.032 Room Home Destroy是generation-bound lifecycle escape hatch，不取得target controller即可终止active run和全部terminal；server shutdown直接destroy all。关闭browser、断开WebSocket、在新标签打开Home或Home New不等于Destroy。

## 任务交接

.032提供Room/Home lifecycle、User Data Root、MacroRecord与shared resource transaction primitive；.033提供Room controller和macro content edit lease；本任务拥有MacroDefinitionV3、唯一validation result/issue gateway、production CRUD/editor、显式draft-layout Prepare、readiness、version-bound Start、immutable run snapshot与structure lock。.036只能消费这里冻结的definition/validator/selection/Copy-only contract，不能调用resolver、改变terminal reference或重新引入Duplicate。
