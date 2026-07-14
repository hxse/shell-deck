# 20260627A.034 Macro Terminal Layout Prepare Validation And Run Snapshot

## 任务概括

在.032的user-global MacroRecord/Room底座和.033的single-writer controller/content edit lease上，.034原子切换production Macro CRUD/editor/runner，并把terminal target破坏性收敛为portable typed layout。可编辑、可复制到clipboard、可放入Library的MacroDefinitionV3只保存名称、说明、连续terminal index/type与Flow body；MacroRecord只在持久层外包record id、revision和timestamps。definition、record与runtime terminal identity三层不得混写。

terminalId跟随live terminal对象，index跟随当前Room UI order。Prepare绑定用户点击时的draft terminalLayout snapshot与terminalStructureRevision，不读取MacroRecord；Start绑定调用者看到的saved Macro revision与terminalStructureRevision，在结构锁内以index查找live terminalId并冻结完整immutable definition与memory-only terminal binding。Action只按frozen terminalId发送，绝不在运行中重读MacroRecord。

Settings不提供terminal Prepare开关，Macro selection也不修改Room。Macro运行控制区在Start左侧提供文字按钮`Prepare terminals`；只有用户点击它才触发Prepare。按钮消费当前正在显示的visual draft或JSON buffer中的validated terminalLayout snapshot，不要求Macro clean、已保存或拥有record identity，也不隐式Save。Save只做portable definition/Flow validation；Start才要求saved revision并校验当前Room terminal结构与readiness。

Prepare只补齐index/type结构，不等待、重启、替换或治疗starting/exited/failed terminal。真实backend操作中途失败时立即停止、保留已成功结果、返回stable error与authoritative snapshot，不做staging或rollback，用户自行修复。任何terminal结构或lifecycle变化都重新校验并标红；Start只验证，不准备。Starting、Running、Paused、Stopping期间冻结terminal结构，但.032 Room Home的generation-bound lifecycle Destroy仍可终止run。Pause/Resume只属于当前live Room，不从Trace恢复。

## 正式 task 级别及定级原因

三星任务。

本任务同时改变Macro current schema、全部terminal-bound Flow actions、Macro editor、content edit lease接入、显式draft-layout Prepare、版本绑定Start API、runner routing、pause/resume、run manifest/evidence和Parallel/capture语义。错误可能造成portable Save被runtime错误阻塞、旧draft触发错误layout mutation、命令发往错误terminal或run中途改读另一个definition，因此需要完整Document Gate、protocol/integration测试和real Room/full browser Gate。

## 范围内

* 定义唯一current MacroDefinitionV3，并把production Macro CRUD/editor/runner原子接入.032 MacroRecord primitive与.033 lease contract。
* saved Macro默认read-only；显式Edit取得macro record lease，Save/Cancel/Delete使用editLeaseId + expectedRevision。
* 定义selectedRecord/baseRecordRevision/draftDefinition/draftRevision/dirty/editLeaseId的唯一editor lifecycle；New draft在Create前没有record identity或lease。
* 最终Macro server surface只保留list/create/read/update/delete；删除Duplicate/clone以及JSON Import/Export，保留clipboard Copy与browser paste。
* 提取唯一public MacroDefinitionV3 object/text validation gateway，并冻结JSON parse position、success/issue exact result、closed code registry、stable path/message与deterministic order；visual editor、JSON Save、CRUD、Library macro-template validation/Load与runner均调用它。
* terminalLayout只保存连续1-based index与shell | text type；terminal-bound Action只保存terminalIndex。Visual editor不展示独立Terminal layout管理区，而是在用户实际选择Action/Lane target时派生连续prefix，并在引用删除或降级后裁掉unused tail。
* 删除terminal alias、rename、可编辑title，以及index | id | alias TerminalTarget union。
* 冻结terminalId跟随对象、index跟随UI order，以及Start时index -> terminalId -> immutable run snapshot的唯一流程。
* 新Room selectedMacro为null；selection、Library Load、Save、Start与terminal事件均零Prepare，只有Macro面板显式按钮触发。
* Target selector只显示authoritative live terminal的`N · type`，不显示`Room`/Macro slot来源后缀；New shell/text事件只刷新选项，绝不改写Macro draft。
* If/Elif/Extract始终允许插入；visual默认artifact source只取插入点之前、当前scope可见的compatible output，不存在时保留明确的未选择source编辑态并由validation阻止Save/Start，不生成猜测或future引用。
* Visual authoring允许非线性搭建和临时invalid draft：用户可先写consumer，再用Add before/Move补齐producer；执行依赖只约束validation与Start，不得成为结构编辑顺序限制。
* Save只执行portable validation和record commit；不读取Room、不触发Prepare、不因terminal mismatch/not-ready失败。
* “MacroDefinition内部是否合法”和“当前Room能否运行”是两层独立真值：前者非法时允许继续编辑但禁止Save/JSON commit/Start；后者mismatch/not-ready时仍允许Save，只禁止Start并显示runtime诊断。definition中的index/type是portable logical truth，terminalId/launchId/readiness只属于live Room。
* Prepare request携带当前draft的terminalLayout snapshot与expectedTerminalStructureRevision；Start携带expectedMacroRevision与expectedTerminalStructureRevision。server commit前复核各自authoritative guard，stale request零mutation。
* Prepare只keep/move/create/insert来补齐结构，绝不delete/reset/restart/rebuild/wait-for-ready。
* Room内terminal和terminalLayout不设产品级数量硬上限；真实OS/backend资源失败直接报错并同步authoritative partial state。
* 枚举全部layout/readiness invalidation事件；变化后只读校验、标红并禁用Start，不reactive auto-repair。
* Start冻结完整MacroDefinitionV3、record revision、terminal binding、Room generation与terminalStructureRevision；run不再读取live record。
* running期间以append-only event log作为唯一lifecycle truth；只读run manifest是由run_started引用的immutable attachment，绝不恢复runner。
* Running/Paused/Stopping期间UI与server共同禁止terminal结构mutation；.032 Home lifecycle Destroy是显式例外。
* 更新validation、editor、runner/evidence、capture/Parallel、tests与active specs。
* 以`.031` Macro工作台的presentation/interaction代码为精准移植基线：优先恢复并改造既有Svelte组件、CSS和行为测试，只替换V3 schema/API/store/runner wiring及本contract明确改变的controls；不因`.032`中间态删除而从空白重新设计Macro UI。

## 范围外

* 不修改.032的User Data Root、Room URL/lifecycle、generated ID、notification config、AgentEvent ingest、per-terminal cwd或browser localStorage ownership。
* 不重新设计.033的controller/edit lease协议、TTL或takeover；只消费其primitive。
* 不实现.036的Library CRUD/editor；只冻结macro-template validation/clean-dirty Load交接与Copy-only/no-Duplicate边界。
* 不增加Use in this Room、Activate、Start-and-prepare或任何隐式/第二套Prepare入口；`Prepare terminals`是唯一入口。
* 不自动处理starting/exited/failed terminal；用户自行等待、restart、delete或新建。
* 不持久化active runner、Pause cursor或resumable snapshot；run manifest/Trace只保存只读证据。
* 不迁移Macro V2、TerminalTarget、alias/configId数据，不提供converter、dual schema或fallback。
* 不顺带调整与V3/lease/Prepare/Start无关的panel比例、toolbar密度、缩进线、action block视觉、icon语言、textarea/line-number/resize手感、collapse/insertion/branch交互或整体配色；合理局部调整必须有本contract理由并在review记录。

## 决策归属

人工已拍板：

* definition和Library的terminal reference只允许index/type；terminalId仅为live runtime防误投工具。
* Save不依赖terminal状态；Start才依赖当前Room terminal状态。
* 新Room不自动选择Macro；切换/重复选择任何Macro都不Prepare，Library Load也不Prepare。
* New后的首次Save与任何普通Save都只validate/commit，不Prepare。
* dirty Start使用明确的Save/Create → Start compound state transition；Save返回的新record identity/revision与Edit session lease保留是允许的phase transition，不被stale guard误判。New Create后先取得fresh record lease再继续保持可编辑；运行终态不会把原editor错误留在灰色read-only状态。
* Prepare期间当前draft、JSON buffer、selector与按钮串行锁定，不能让请求绑定的terminalLayout snapshot漂移或重叠。
* Settings中不存在Prepare toggle；Macro面板文字按钮`Prepare terminals`是唯一显式入口。
* Copy只表示把当前JSON文本写入clipboard；Macro与Library都不提供Duplicate/clone/copy-and-create。
* starting/exited/failed terminal由用户处理，程序只校验和报错。
* 不设置MAX_TERMINALS_PER_ROOM或terminalLayout长度上限；Room容量上限只限制Room数量，不限制Room内terminal。
* Prepare真实backend操作失败时立即停止并直接报错，保留此前已经成功的结构调整并返回最新authoritative snapshot；不做staging、rollback或自动修复，后续由用户调整。
* active run的terminal结构冻结持续覆盖Pause，但Destroy Room始终允许。
* append-only event log是run lifecycle唯一真值；Trace/artifact/run manifest只读保留，server restart不恢复Pause/Resume或runner。

AI可直接实现：

* MacroDefinitionV3/MacroRecord分层、唯一validation gateway、production CRUD hard cut与legacy kill。
* .033 macro lease接入、editor draft/revision lifecycle、stale async operation guard。
* 删除Macro Duplicate/Import/Export；保留non-mutating clipboard Copy与New/Paste/Save路径，并对clipboard reject显示稳定错误而不伪报Copied。
* terminalStructureRevision只跟踪binding变化、readiness独立invalidation、layout-bound Prepare、record-version-bound Start与stable错误。
* immutable full-definition run snapshot/frozen-ID routing、event-log-first lifecycle truth、atomic manifest bootstrap、.032 lifecycle ticket、structure lock与Home Destroy例外。
* 全部unit/integration/browser Gate。

需要人工拍板：无。
