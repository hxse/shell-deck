# Contract

## 任务边界

本任务建立 shell-deck 唯一的 User Data Root、Room routing、shared content store、per-terminal cwd 和 browser-local settings contract。后继任务必须直接消费本 contract，不得另建 Project、Directory、config、profile、workspace 或 target-working-directory abstraction。

### Destructive cutover 与 UI preservation 边界

`.032`的schema/API hard cut与中间态UI删除是两件事。为了不保留Macro V2临时adapter，本revision允许production Macro/Prompt/Run panel在代码层暂时不可用；它不是standalone release candidate，也不把“只剩Shell/Text”定义为最终产品形态。`.031` revision中的Svelte component、CSS、toolbar密度、panel编排与已精调交互是.033-.036的reference implementation；它们不是旧schema真值，后继只能移植仍符合新contract的presentation/interaction代码，不能恢复旧store、route、type、validator或兼容路径。

后继重构遵循最小必要变化：新contract明确要求的control、state和field可以增加、删除或局部调整；与任务无关的布局、配色、字号、spacing、icon语言、editor手感、collapse/insertion流程和panel比例默认保护。这里不建立截图或像素冻结Gate，也不禁止合理UI改进；但任何有意偏离必须在所属task的`02_spec`写清“为什么新contract需要”，在`03_execution`列出受影响UI文件和最小修改面，在`04_review`逐项回填。仅以“重写更方便”“旧文件曾在.032删除”为理由不成立。

交付停止线：

* public domain term 统一为 Room；一个 server process 可以同时服务多个 Room。
* GET /是Room Home入口：零live Room时原子创建首个随机Room并以不可缓存的302跳到/<roomId>；已有Room时返回Room Home且零Room mutation。
* 不同 roomId、不同 server process 的 Room/PTY/runner 严格隔离。
* Room 是 single-user multi-device session，不是多人协作空间；支持用法是单一客户端操作、其他客户端观察或接续操作。
* roomId只是未持久化route token；Root/Home New由server factory生成，direct canonical URL允许格式合法token作为唯一caller-provided identity例外；serverInstanceId + roomId + roomGeneration才标识一次live runtime。
* 关闭或刷新browser、导航离开、WebSocket断开都不销毁Room；Room Home可New/Open/Destroy，Room页Home按钮在新标签页打开/，Ctrl+C、SIGTERM和正常server stop销毁全部Room。
* 每个server process最多32个live Room，不做idle TTL或自动回收；所有创建入口共享同一capacity guard，达到上限时返回room_capacity_reached。
* User Data Root持久化user-global Macro、Library与只读Trace/evidence；notification-profiles.json从legacy path迁入，schema与文件字节原样保留。
* .032只建立MacroRecord envelope/path/canonical resource transaction/shared-store primitive；.033建立Room controller与共享内容编辑租约；.034定义MacroDefinitionV3并原子切换production CRUD/editor/runner。
* active runner、Pause cursor、run snapshot、terminal、Text/replay 和 Room metadata 全部 memory-only，绝不从 Trace 恢复。
* Shell cwd 只属于一个 live terminal，不属于 Room、Macro、Library 或内容 scope。
* 多个 server process 可以共享同一 User Data Root 的长期内容，但绝不共享 live Room。
* UI preference只写versioned browser localStorage，不写server file。
* 所有系统生成的opaque identity使用short-uuid 6.0.3、相同22位Base58 UUID v4后缀与typed prefix；业务模块不得直接import short-uuid。
* configId、Project/projectId/ProjectRegistry、Directory scope、产品级Server Profile和旧路由直接删除，不兼容、不迁移；唯一例外是notification配置文件的byte-preserving path relocation，notification/parser profile本身不在删除范围。
* .032不得注册临时Macro schema/API或duplicate/clone入口；Foundation Gate由just test-032阻断，但.032不是standalone release candidate，stack/release Gate必须继续通过.034完整Macro Integration。
* just check、just build、just test-unit、just test-032、current browser E2E与git diff --check为阻断Gate。历史测试中仍属于Room/PTY/replay/backpressure/notification/parser底座的断言必须迁到current-schema测试；依赖已删除Macro V2/config/Deck contract的测试与命令直接删除，不保留不可运行的legacy Gate，Macro integration由.034重新建立。

Room controller与跨Room/process共享内容编辑租约由.033负责；MacroDefinitionV3、production Macro CRUD/editor、Prepare/Start算法与run snapshot由.034负责；Library record、CRUD、editor与Load into Macro由.036负责。

Room-scoped AgentEvent ingest与外部 just codex拒绝语义为本任务阻断项；不允许 manual identity、unbound evidence或spool import fallback。

## 任务规范

### User Data Root 与长期内容

唯一 User Data Root 按以下顺序确定：

1. 显式 SHELL_DECK_DATA_ROOT。
2. $XDG_DATA_HOME/shell-deck。
3. $HOME/.local/share/shell-deck。

它是 OS 用户的数据边界，不是产品内可切换配置，也不与 server cwd、Room URL 或 terminal cwd 相关。不存在 Project registry、--default-project、产品级 --profile/Server Profile 或 per-directory bucket。notification action/profile和 parser profile是现有独立业务概念，不得因同名字段被删除。

固定布局为：

    <user-root>/
      macros/<macroId>.json
      notification-profiles.json
      library/<kind>/<itemId>.json
      runs/<runId>/...
      agent-events/...
      .locks/...

.032实现root resolution、Macro path/envelope ownership primitive、run/evidence relocation与shared-store primitive。.036实现Library record/API/UI，但必须逐字使用library/<kind>/<itemId>.json，不能再增加Directory/Global层级。任何terminal cwd下都不得自动创建.shell-deck或内容文件。

V0 POSIX filesystem permission contract如下。server创建的User Data Root、macros、library、runs、agent-events和.locks目录一律以0700创建；notification、Macro、Library、Trace/artifact/evidence与lock state普通文件一律以0600创建。atomic replace使用的same-filesystem temporary file必须在写入secret/content前以0600创建，并在rename前复核mode；不能依赖process umask，也不能先用宽权限创建后再收紧。server不得跟随由自己管理的content/lock path中的symlink。

对于已经存在的显式root或历史文件，server启动时检查POSIX group/other permission bits。User Data Root或非notification内容过宽时稳定记录user_data_permissions_too_open warning，但不得把文件内容写入warning；notification-profiles.json、其relocation source或target只要不是regular file、存在symlink或group/other可读写执行，notification subsystem就fail closed为notification_config_permissions_too_open，Room、terminal和其他非notification功能仍可启动。server可把自己新建或atomic replace的target收紧到上述mode，但不得静默chmod用户预先存在的显式root。非POSIX平台的ACL/permission hardening不在V0范围，不能伪报已执行POSIX mode检查。

同一 User Data Root 可被多个 server process 并发使用。共享 store mutation 必须使用短生命周期 cross-process filesystem lock、same-filesystem temporary file、fsync/atomic replace 和 optimistic revision。冲突返回 content_revision_conflict，不能静默 last-write-wins；crash 残留 lock 不能永久阻塞。另一个 process 在 mutation 完成后的下一次 read/refresh 必须看到最新提交。

record filesystem mutation的point-of-no-return是成功的`rename`或`unlink`。底层phase-aware publisher必须区分publish前失败与publish后durability确认失败：publish前失败正常抛出且不得改变authoritative record；publish后parent-directory fsync失败返回`published + durability uncertain` receipt。Macro/Library store必须在同一resource guard内重读并核对intended exact bytes，或确认Delete后的path确实不存在；核对成立即按authoritative success返回，后继route必须广播saved/deleted，不能向client报告失败后再让重试得到revision conflict/404。SQLite transaction只承担advisory cross-process lock，不保存业务数据；`operation()`成功返回后的COMMIT/ROLLBACK release故障也不得反转已发布业务结果。notification等需要保留source的严格调用方仍可把uncertain receipt升级为错误，不得用全局吞错替代phase-aware语义。

Macro/Library record的唯一cross-process commit边界是canonical per-resource transaction guard。resource key直接从User Data Root内规范化record相对路径派生：macros/<macroId>.json或library/<kind>/<itemId>.json；lock filename使用安全deterministic encoding/hash，不接受caller path。record create/update/delete与.033对同一record执行的edit lease acquire/renew/release/takeover必须短暂取得同一个guard，不能分别使用互不协调的store lock与lease lock。update/delete在guard内按固定顺序重读lease state、record revision并atomic replace；takeover必须等已进入commit区的旧Save完成，或先取得guard使旧Save随后读到lost lease。read/list不长期持锁，只读取atomic file truth。

该guard只覆盖一个resource的一次短事务，不在整个Edit会话持有OS lock；不同record可并行。notification relocation使用自己的target-scoped lock，不与content resource嵌套。后继.033只能复用此primitive，不得另建第二套会与record commit交错的per-record coordination protocol。

本任务不建立跨 process WebSocket federation。发起 mutation 的 process 立即通知自己的 clients；另一 process 通过下一次 list/read、reload 或显式 Refresh 读取共享文件真值。
notification-profiles.json继续使用当前独立配置语义，保存用户手工配置的Telegram token/channel等secret。它不属于Macro、Library或已删除的Server Profile，不提供写API，不把secret返回browser或写入Trace。Macro notify action只保存channel/profile selector。

路径relocation contract。所有server process都必须先取得target-scoped短生命周期cross-process relocation lock，再在lock内重新读取legacy/target完整矩阵：

1. legacy source精确为join(SHELL_DECK_DATA_ROOT ?? process.cwd(), ".shell-deck", "notification-profiles.json")。
2. target精确为join(resolvedUserDataRoot, "notification-profiles.json")。
3. target缺失而legacy存在时，按raw bytes复制到target目录的same-filesystem temporary file，fsync并atomic replace；成功后重新确认target byte-identical，再幂等删除该legacy source。不得parse/reserialize或改变文本字节。
4. target与legacy都不存在时沿用当前“profile config missing”语义；target存在而legacy不存在时直接读取target。
5. 两者都存在且byte-identical时以target为真值并幂等清理legacy；内容不同时返回notification_config_path_conflict，不覆盖、不合并、不删除任一文件。
6. 多个不同cwd的legacy source并发迁往同一target时只允许一个winner。后取得lock的process必须重新读取target；若与自己的legacy不同，返回notification_config_path_conflict并完整保留自己的source，绝不以启动顺序覆盖target。
7. relocation成功后runtime只读取target，不fallback、dual read或持续扫描legacy path。just notification-config-init也只写target。
8. notification_config_path_conflict不阻止Room、terminal、Macro等非notification功能启动；notification subsystem保持unavailable并稳定暴露该错误，notify action按既有onFailure语义处理，init命令明确失败。任何API、Trace或错误正文都不得泄漏secret bytes。

这是用户明确授权的单一file relocation例外，不允许扩展成Macro、Library、Project或其他旧数据migration。

Macro持久层与可执行语法分离：

    type MacroRecord<TDefinition> = {
      id: string
      revision: number
      createdAt: string
      updatedAt: string
      definition: TDefinition
    }

id由server通过createGeneratedId(macroTemplate)生成；revision从1开始并在每次成功update后递增；timestamps由server生成。.032只实现和测试generic envelope/path/lock/atomic replace/revision primitive，使用opaque test definition验证store，不注册新的production Macro CRUD，也不接入editor或runner。

.034定义并验证唯一MacroDefinitionV3，再把production CRUD、JSON editor、runner和Trace identity一次性接到该primitive；其record编辑必须消费.033的共享内容编辑租约。禁止为了让.032中间态可运行而增加temporary schema、dual validator、compat adapter或隐藏fallback。


### 持久化矩阵

| 状态 | ownership | 介质 | restart 后语义 |
| --- | --- | --- | --- |
| MacroRecord primitive | User Data Root | server file | .032建立底座；.034 production cutover后保留并跨process共享 |
| Library | User Data Root | server file | 保留并跨 process 共享 |
| run Trace/artifact/AgentEvent | User Data Root | append-only/read-only evidence | 保留，只用于查看 |
| UI preference | browser origin | versioned localStorage | 仅恢复 UI preference |
| notification config | User Data Root | user-managed secret JSON | 保留并跨 process只读使用 |
| roomId | URL | route token，不建持久化 registry | 相同 token 可创建新 generation |
| Room/terminal/Text/replay | serverInstanceId + roomId + generation | memory | 全部丢失 |
| runner/Pause cursor/snapshot/lock | live Room | memory | 全部丢失，不能 Resume |
| selected Macro/unsaved draft | browser client | memory | 不作为 server 持久化真值 |
| Shell cwd | live Shell terminal | memory | terminal 消失时一并丢失 |

run Trace、artifact与AgentEvent是provenance，不是配置或checkpoint。它们可以记录serverInstanceId、roomId、roomGeneration、terminal index/type/id和runId；不得存储可重新激活的Room handle，不得驱动Resume。AgentEvent只有经过live Room membership校验后才落盘和供capture消费。server restart后旧unfinished Trace只显示derived interrupted；对旧run调用Resume返回run_not_active。

### Unified generated ID contract

package.json直接依赖short-uuid 6.0.3系列，bun.lock锁定exact resolved version。src/lib/generatedId.ts是唯一允许import short-uuid的production模块，使用v6 createTranslator与默认Flickr Base58 alphabet、consistentLength=true和默认native crypto.randomUUID。不得保留v5 default export、translator.new()或uuid package direct dependency。

统一suffix固定22字符，是完整UUID v4的Base58编码，随机熵约122 bits。生成与校验不得截断suffix、改alphabet、拼Date.now/Math.random、使用process-local counter或把普通UUID字符串直接slice。公共API至少提供createGeneratedId(kind)、assertGeneratedId(value, kind)、isGeneratedId(value, kind)、assertRoomRouteToken(value)和只供内部文件名使用的createGeneratedSuffix()；校验必须验证exact prefix、exact length、alphabet、strict UUID round-trip、decoded UUID version精确为4且variant满足RFC 4122，不能只调用宽松assertValidPublicId或把short-uuid library的通用RFC UUID validation误当成v4 validation。

system-generated entity prefixes冻结为：

| kind | prefix |
| --- | --- |
| Room | room_ |
| server instance | server_ |
| Room generation | roomgen_ |
| connected client | client_ |
| terminal | term_ |
| terminal launch | launch_ |
| Macro record | tmpl_ |
| run | run_ |
| run event | evt_ |
| Library item | lib_ |
| notification | notif_ |

除下一节冻结的direct Room URL lazy-create例外外，这些ID必须由server authoritative factory创建；browser和request body不得自造identity。persistent store仍须用exclusive create/revision与collision retry，Room/client memory map也在极小概率碰撞时重新生成，不能把随机性替代原子性。assertGeneratedId/assertRoomRouteToken只能证明格式、UUID version与variant合法，不能也不得声称证明token由当前server生成。

Flow node、if/elif/else branch、parallel lane、for entry与其他模板局部semantic key不进入该表，继续使用可读、scope-local unique规则。terminal index是ordered position，不是ID。artifactRef与tmp filename是path，不是public entity identity；需要随机suffix时只能调用createGeneratedSuffix，不能重新初始化translator。

current-schema-only要求所有新写入/当前runtime identity满足本contract。term_abc、prompt截断ID、client_1、notif_<node>_<suffix>与r_<21-char>不再是positive generated-ID fixture；不migration、不alias、不dual validation。历史只读Trace可按原始字符串展示，但不得把旧ID重新激活为runtime identity。

### Room runtime identity

每次 server 启动生成新的 opaque serverInstanceId 和 Room generation source。serverInstanceId 不进入 URL、Macro、Library 或 browser storage，只用于 runtime 防混淆与 Trace provenance。

public Room key只有roomId。Root首建与Home New必须通过createGeneratedId(room)生成roomId；格式精确为room_加22位默认Flickr Base58 UUID v4。direct GET /<roomId>允许caller提供通过assertRoomRouteToken()的route token并在runtime不存在时lazy-create，这是“所有entity identity由server factory创建”规则的唯一例外。该例外只存在于canonical URL path，不允许request body、WebSocket payload或其他entity create API提供identity。roomId只是URL token，不建立持久化Room registry、不写磁盘，也没有title、cwd、Project或owner metadata；不存在固定main、用户命名、自增ID或单独Room随机算法。

server process内部按roomId维护live Room map，并用一个Room manager critical section串行化zero-room root ensure、Home New、合法URL lazy ensure、Destroy和capacity计数。每个process的MAX_LIVE_ROOMS精确为32；这是V0固定runtime上限，不写User Data Root或browser storage，也没有idle TTL或自动回收。Room至少拥有roomGeneration、ordered terminal collection、connected clients、output replay state、active runner与monotonic roomRevision。roomRevision覆盖所有browser可观察的Room/terminal state mutation，而不是只覆盖structure：create/delete/reorder/reset、Text正文、PTY output、status/size和cwd变化都递增；新generation从0重新开始。

GET /在同一critical section读取live map：count=0时调用统一Room ID factory生成不冲突token，立即创建roomGeneration与空Room，再返回302 Found、Location /<roomId>和Cache-Control: no-store, private；count>0时返回200 Room Home，零创建、零重定向。两个并发zero-room GET不能各创建一个首Room；先取得lock者创建，后取得者看到count>0并得到Home。

直接访问assertRoomRouteToken()通过的/<roomId>时，已存在runtime直接进入；不存在且count<32时，以该route token创建新generation；不存在且count=32时零mutation并返回room_capacity_reached错误页，提供返回/的入口。Home New通过POST /api/rooms生成新的随机token和runtime；root首建、Home New和direct-token ensure都调用同一个capacity-checked create service，碰撞retry不能绕过容量。GET /api/rooms只枚举该map，不写磁盘。

内部 identity精确为 serverInstanceId + roomId + roomGeneration。Destroy后再次访问同一 /<roomId>，或 server restart后访问旧 URL，都会复用 token但创建新 generation；terminalId、launchId、Text content、replay、active run和 Pause cursor不恢复。

最后一个client断开不销毁Room。Room lifecycle状态机精确为active -> destroying -> destroyed；不存在destroying回到active，也不存在destroyed object复用。每个Room拥有统一lifecycle admission gate、generation-bound operation ticket registry与abort signal。所有Room-scoped mutation，包括terminal create/delete/reorder、Prepare、Start/Pause/Resume/Stop和runtime ingest，在第一次读取或await前必须从active Room取得ticket；destroying拒绝新admission为room_destroying，destroyed或map缺失返回room_not_found。取得ticket不允许操作忽略后续Destroy：每个PTY spawn、fsync、event append或其他await返回后，以及任何terminal/run/runtime state publish前，都必须复核ticket未abort、Room仍为同一generation且lifecycle仍为active；失败时不得publish，并清理本操作新建但尚未交付的resource。abort后唯一允许的写入是关闭已经durable run_started provenance所必需的best-effort terminal evidence；它不得创建或恢复任何runtime state，失败时Trace仍按interrupted派生。

Room Home调用DELETE /api/rooms/:roomId并携带从list看到的expectedRoomGeneration；server在Room manager critical section复核target generation并原子执行active -> destroying、关闭新mutation admission，stale Home不得删除同token后来创建的新generation。Destroy是显式server lifecycle management operation，不属于.033目标Room controller守护的普通Room mutation；Home必须先确认。进入destroying后，server必须先触发Room abort signal、abort runner并cancel尚未开始的Room mutation queue，让持有content transaction/structure lock的在途operation立即进入退出路径；随后撤销target controller及其content leases，等待所有已admit ticket完成、失败或确认清理，再终止全部既有terminal/process、通知并断开clients，原子标记destroyed、移除live map entry并释放一个capacity slot。不得先阻塞等待content/structure guard、再延迟发送abort。Destroy不得在仍有可publish runtime state的operation ticket时移除map entry；被abort的操作不得在map removal后插回terminal或安装in-memory run。若Destroy前已有durable Trace/event commit完成，可保留为只读provenance，但Destroy必须使其最终状态明确为room_destroyed/interrupted，绝不据此恢复runtime。

即使目标Room处于Starting/Running/Paused/Stopping也始终可Destroy，且不受.034 run structure lock阻止；lifecycle gate优先于structure lock，任何代码不得等待structure lock后才关闭Destroy admission。server shutdown/destroyAllRooms走同一state machine与drain/cleanup，只是无需browser request。target不存在返回room_not_found，generation不匹配返回room_generation_conflict，两者均零mutation；对同一generation并发Destroy只有一个active -> destroying winner，其余返回room_destroying或room_not_found，不能重复cleanup。

Home销毁最后一个Room后保留空列表与可用New按钮，不在当前已加载页面中自动创建；只有新的GET /才应用zero-room首建规则。目标Room clients收到room_destroyed后停止重连旧generation并导航到/；普通Close/Leave只断开当前client。

不同 server process 即使共用 User Data Root、roomId 和相同 path，也拥有不同 Room。localhost、LAN IP、域名或 reverse proxy 只要最终到达同一 process 和相同 roomId，就连接同一 Room。
SIGINT（Ctrl+C）、SIGTERM、just stop与正常server close必须调用同一个destroyAllRooms流程，完成所有Room runtime清理后退出；不得仅关闭listener而遗留PTY进程。PID file是current-schema-only JSON record，至少绑定schemaVersion、pid、serverInstanceId与Linux `/proc/<pid>/stat` process start time；plain-number旧PID file不读取、不转换。just stop只有在start time与精确Bun `server/httpServer.ts` argv同时匹配时才发送signal，`/proc`/cmdline读取失败必须fail closed，不能用包含`"shell-deck"`的模糊字符串或读取异常放行；已退出或zombie process只清理自己的stale PID record。


### Canonical URL、HTTP 与 WebSocket

canonical UI route为：

    /:roomId

UI catch-all只接受assertRoomRouteToken()成功的room_<22-char-base58 UUID-v4>；/api、/ws、assets、favicon与其他system routes优先匹配，不能被当作Room。根路径/不是Room alias：零Room时创建首个Room并302，已有Room时返回Room Home。重复进入/是否redirect只由请求进入critical section时的authoritative live count决定。

Room WebSocket为：

    /ws/rooms/:roomId

Room runtime API使用：

    GET    /api/rooms
    POST   /api/rooms
    DELETE /api/rooms/:roomId

    /api/rooms/:roomId/...

Room-scoped API至少包括terminal lifecycle、reorder/replay、macro Prepare、runner Start/Pause/Resume/Stop和AgentEvent ingest。connection path冻结roomId；client payload不得覆盖。GET /api/rooms返回当前process的memory-onlylive summaries，每项至少含roomId、roomGeneration、terminalCount、connectedClientCount和hasActiveRun。POST /api/rooms exact empty body，在capacity guard内创建随机Room并返回summary与/<roomId> URL；count=32时返回room_capacity_reached。DELETE exact body为{ expectedRoomGeneration }并执行上一节的Home lifecycle Destroy。非法roomId、unknown field与stale generation明确失败，不fallback、不修正，也不生成另一token。

Room Home不是Room runtime client，不建立Room WebSocket、controller、terminal selection或runner state。它在load、window focus、显式Refresh以及New/Destroy response后调用GET /api/rooms；跨process没有Room共享，另一个process拥有自己的Home清单。Home显示N / 32，未达上限时New可用，达到上限时disabled并解释必须先Destroy；server guard仍是容量真值。Open点击清单后让当前页面location.assign(/<roomId>)；New成功后同样在当前页面进入新URL。Destroy先显示目标terminal/connection/active-run摘要并确认，成功后刷新列表；销毁最后一个Room时显示empty state与New。

Room工作区顶栏删除Rooms (N)菜单、菜单内New/Open/Destroy以及产品级Copy Room URL按钮，只保留Home按钮。Home按钮在直接用户点击中执行window.open("/", "_blank", "noopener")，当前Room连接和运行不变。共享Room URL直接使用browser地址栏。已连接页面收到自身generation的room_destroyed后必须用history replace在本地切换到Home view并调用GET /api/rooms，不得再发GET /；否则销毁最后一个Room会被root首建规则立即反向创建新Room，破坏Home empty state。用户之后主动reload /仍按root双态规则处理。

Macro的最终user-global CRUD与request/response schema由.034冻结并实现；.032只保留<user-root>/macros/<macroId>.json路径、MacroRecord envelope和shared-store primitive。旧config-scoped Macro routes随configId删除，但.032不注册半成品replacement API。

最终Macro surface只允许list/create/read/update/delete，不存在duplicate、clone或copy-and-create route。Copy属于client clipboard operation，不是server mutation。.034负责删除现有Macro Duplicate UI/client/store/route，并接通完整CRUD；.036不得重新引入Library duplicate。

Library的user-global API由.036实现，但不得包含roomId、projectId或scope。最终Macro definition与Library item都不得保存configId、projectId、Room identity、server URL、cwd、terminalId或launchId。

### Room-scoped AgentEvent ingest

AgentEvent live ingest唯一入口为POST /api/rooms/:roomId/agent-events。server为每次启动生成memory-only ingest token，并向自己创建的Shell terminal注入ingest URL/token、roomId、roomGeneration、terminalId和launchId。hook body不得覆盖path roomId；server补serverInstanceId/receivedAt，并验证token、当前roomGeneration以及terminalId/launchId仍属于目标Room后，才append user-global evidence并通知该Room的capture waiter。Macro只能消费与当前serverInstanceId、roomId、roomGeneration、configured terminal和launch匹配的事件。

just codex wrapper必须要求完整注入context；普通外部terminal缺字段时在启动Codex前返回shell_deck_room_context_required。删除term_manual/launch_manual/config local fallback、全局POST /api/agent-events、disk spool/import route和unbound evidence。成功落盘的evidence只供Trace/capture，不恢复Room或runner。


旧 /r/:roomId、/ws/r/:roomId、固定 /r/main、/p/:projectId/r/:roomId、/api/projects/**、/api/configs/**、?configId=、/ws?configId=与产品级Server Profile path全部未注册并fail loudly，不redirect、不alias。现有notification profile读取API与parser profile不在此列。

### Terminal cwd 与 runtime ownership

Shell terminal create request可包含cwd；server只接受存在且可访问的absolute directory。它也可携带精确的`cwdSource: "last-shell"`意图，但`cwd`与`cwdSource`互斥，其他cwdSource fail loudly。两者都省略时精确使用当前OS用户的`$HOME`，不使用server `process.cwd()`，也不从URL、Macro或browser preference推导。

production创建的real Shell不改写`HISTFILE`，继承server进程的用户环境，可与本机其他terminal共享全局Shell history。自动化测试不得消费该production语义去向用户history写fixture：官方Bun integration入口、Playwright wrapper/webServer与直接real-PTY fixture均必须在spawn前强制`HISTFILE=/dev/null`。该覆盖只存在于test process/terminal env，不得在production backend增加`NODE_ENV`分支或隐式test mode。`/dev/null`只禁止跨session读写，不禁止测试Shell当前进程的in-memory上方向键history。代码不自动编辑或清理用户既有history文件。

Room UI的New shell不得显示cwd prompt/dialog，也不得从cached terminal snapshot回传path；client只发送`cwdSource: "last-shell"`。server在Room operation内按authoritative terminal order选择`terminalIndex`最大的非Text terminal，在创建新Shell前同步读取该source的current cwd；Text即使位于最后也必须跳过，拖拽后“最后一个Shell”随UI index实时变化。没有Shell或probe不可用时使用`~`/`$HOME`。该规则只属于用户点击New shell；.034显式Prepare创建的Shell仍明确使用`$HOME`，不得复用最后一个Shell cwd。

Text terminal没有cwd。Shell terminal runtime object的cwd初值为resolved launch cwd，之后表示server最后一次成功观察到的resolved current process cwd。真实PTY backend必须提供current-cwd probe；V0 Linux实现读取同用户Shell process的`/proc/<pid>/cwd`，读取失败不得覆盖最后已知值。server在输出quiet-edge debounce后刷新，并在Room snapshot/New shell继承前同步刷新；变化时只广播轻量`terminal_cwd`，不得为cwd变化重发包含replay的完整snapshot。cwd变化递增本节定义的live roomRevision/terminalRevision，但不得递增.034单独定义的terminalStructureRevision。terminal关闭/reset/Destroy必须取消pending probe。Fake遵循可测试的稳定cwd，Text不参与。cwd不持久化。

真实PTY helper与生成bashrc只能安装在当前uid拥有且group/other无权限的0700 runtime directory。server对自己管理的runtime root、bin与etc每一级使用`lstat`，拒绝symlink、non-directory、owner不匹配或宽权限路径，不得用recursive mkdir/chmod跟随预置symlink。helper不能因已有文件mtime较新而受信；每个server process首次使用时在已验证目录内构建unique temporary regular file，复核owner/mode、fsync后atomic rename并fsync目录。cached helper与bashrc每次复用前仍须是当前uid拥有的regular file且分别为0700/0600；symlink、device、directory或mode异常均fail loudly。

Terminal tab与pane header调用同一个display formatter，canonical label精确为`index · terminalId · [cwd ·] kind · status`；Text省略cwd。两处可见文本必须相同、单行、`text-overflow: ellipsis`，完整文本进入`title`。pane header允许选择复制；tab close control固定保留且不被label挤出。不得重复terminalId或在tab/header分别维护字段顺序。

Terminal runtime、WebSocket protocol、UI 与 evidence 都不再存在 alias/rename identity。用户看到的terminal label由当前连续index、runtime terminalId、可选live cwd、kind和status构成；index随UI顺序实时变化，cwd随Shell process变化，terminalId/launchId跟随terminal object。Room client mutation只能用terminalId或当前index定位，旧terminalAlias field、rename_terminal message和alias selector必须按current-schema-only fail loudly。.034 的MacroDefinition只保存index/type，Start再把index解析为当前terminalId并冻结run snapshot。

.034 的 Prepare 自动创建缺失 Shell 时不弹 cwd 对话框，统一使用 $HOME。Macro readiness 只比较 terminal index 和 kind，不比较 cwd；用户负责让对应 Shell 进入所需目录。Macro 可以在同一 Room 内同时操作 cwd 完全不同的多个 Shell。

### Broadcast 与客户端状态

server message scope 只有：

* Room runtime：terminal input/output/lifecycle/order/replay、runner、room revision；只发当前 process 同一 Room clients。
* User content：Macro 与 Library mutation；发 mutation process 的全部 clients。
* Client-local：selected terminal/Macro、unsaved draft、panel/editor state；不广播。terminal snapshot只能更新集合，不能让observer跟随另一个client的新建行为切换active terminal；create成功后server只向发起连接发送`terminal_created`，由该client选择新terminal。没有有效selection时各client才本地选择第一项。

同 Room input/output 继续使用 server-authoritative FIFO、replay/backpressure contract。所有 async terminal routing 必须以当前 process + roomId + roomGeneration + terminalId 定位，不能只用 index 或 terminalId。User content broadcast 不是跨 process live sync；shared file read 才是跨 process 内容真值。browser把完整 replay/replace 写入新xterm实例时属于历史 hydration：从开始写入直到write-pump parser callback确认完整update已消费，xterm stdin必须关闭，历史中的DA、cursor position、OSC 10/11等terminal query不得通过`onData`重新进入PTY。完成 hydration 后的live append仍正常响应terminal query；禁止通过篡改replay、剥离escape sequence或全局禁用query response规避问题。

每个Terminal runtime另维护同launch单调terminalRevision、textRevision与outputActivityRevision。terminalRevision覆盖该terminal任何browser可观察变化；textRevision只覆盖Text全文提交；outputActivityRevision在PTY output或Text正文变化时递增，绝不从bounded replay tail长度推导activity。RoomSnapshot携带roomRevision，每个TerminalSnapshot与terminal-specific delta携带roomRevision、launchId及三项terminal revision；index map携带roomRevision。browser按roomGeneration隔离真值：跨transport的完整Room snapshot/index map低于已观察roomRevision时丢弃，terminal-specific event按terminalId + launchId + terminalRevision单调合并，因此不同terminal经animation-frame batching重排也不会互相吞掉。任何HTTP continuation都不能把旧snapshot赋予新的local render revision后覆盖较新WebSocket真值。

Text editor每个terminal只允许一个在途full-state write；后续keystroke只更新browser内最新值和单调local edit generation。server echo只有在textRevision前进且正文匹配在途write时才确认它；确认后若local generation更高，client必须基于新revision再发送一次最新全文，即使最新全文恰好与较早在途值相同。旧echo、旧snapshot或intermediate remote value不得覆盖更晚local input；observer仍按server textRevision收敛。该机制不建立browser-to-browser同步，server仍是唯一Text真值。

### Browser-local settings

multi-client只表示同一用户的多个连接同步观察和顺序接续操作，不表示多人或并发编辑。当前任务保留server-authoritative FIFO/queue/revision作为防御性一致性边界；.033必须补齐server-enforced Room controller与共享内容编辑租约，不能把client-only disabled state当作并发安全。

panel width/visibility、Macro insertion placement、terminal drag toggle、notification volume与Library selected tab/filter使用一个strict versioned localStorage schema。terminal Prepare是Macro面板显式Room mutation，不是browser setting；schema不得保存`autoPrepareTerminals`或任何等价开关。本次破坏性切换只读取current v2 key/schema，不读取、删除、转换或alias旧setting。

Room 由 URL 选择。selected terminal、selected Macro、unsaved draft 和 editor state 是 client-local。删除 server-persisted Prompt/layout store、HTTP route、file 与 WebSocket message。旧 localStorage schema 显示 reset notice 后使用 current defaults，不 alias 或上传 server。

### Legacy Kill List 与后继边界

实现完成时必须删除或不可达：

* Deck/TerminalDeckManager/DeckSnapshot 等 public naming。
* configId URL/query/API/WS/message/path/store map/default-local namespace。
* ProjectRecord、ProjectRegistry、projectId、--default-project 与 /api/projects/**。
* Directory/Global content scope、canonical rootPath、target working directory 和 project-local .shell-deck/**。
* 产品级Server Profile、对应--profile参数与server profile routes/files；明确保留notification-profiles.json、notify channel profileId和parser profileId。
* PromptStore/Client、Prompt routes/messages/files与 server-persisted ui-layout。
* 外部just codex的manual identity/default config、unscoped AgentEvent ingest、disk spool/import与unbound evidence。
* fixed main、旧r_<21-char> Room ID、/r/:roomId与/ws/r/:roomId、持久化Room registry/runtime、active-run recovery、cross-process Room attach。
* 每次GET /无条件创建Room、Room顶栏Rooms (N)菜单、菜单内New/Open/Destroy、产品级Copy Room URL、无capacity guard的lazy ensure。
* production模块各自import short-uuid、v5 translator.new()、prompt suffix截断、client counter、notification composite random ID与宽松generated-ID validator。
* migration、legacy parser、path scan、alias、dual read、Convert或automatic import；仅允许本task精确定义的notification raw-byte relocation。
* config-scoped或user-global Macro duplicate/clone route；.032不创建replacement，.034删除现有Duplicate surface。

.033只拥有Room controller、single-writer enforcement与跨Room/process共享内容编辑租约primitive；不得定义Macro terminal schema、Prepare或Library内容模型。.034拥有MacroDefinitionV3、production Macro CRUD/editor、terminal schema、Macro面板显式Prepare terminals、Start validation、terminal snapshot、run structure lock与Macro租约接入；不得修改root/routes/content sharing/cwd ownership，也不得让structure lock阻止Destroy。.036只拥有single user-level Library record/store/API/UI/Load与Library租约接入；不得恢复scope或Room semantics。

## 示例

### 一个 Room 操作多个目录

server尚无Room时，用户访问/；server原子创建room_73WakrfVbNJBaAmhQtEeDv并返回302 Location。用户在其中创建Shell 1，cwd为/home/user/repo-a；创建Shell 2，cwd为/home/user/repo-b；再创建Text 3。Macro同时向Shell 1和Shell 2发送内容，只引用terminal index/type，不记录两个cwd。

用户从browser地址栏复制完整Room URL并在Android打开，两端属于同一用户：一端操作时另一端同步观察，之后可在另一端接续；不得把同时操作写成受支持的协作场景。用户在Room顶栏点击Home，新标签页GET /；因为已有Room，server返回Room Home。Home清单来自：

    GET /api/rooms
    { "rooms": [
      { "roomId": "room_73WakrfVbNJBaAmhQtEeDv", "roomGeneration": "roomgen_...", "terminalCount": 3, "connectedClientCount": 2, "hasActiveRun": true },
      { "roomId": "room_Y8fK6cLq9xN2WvR4mP7sTa", "roomGeneration": "roomgen_...", "terminalCount": 0, "connectedClientCount": 0, "hasActiveRun": false }
    ] }

用户在Home点击New，POST /api/rooms成功后当前Home页跳到另一个随机URL；点击清单项也在当前页进入对应Room。另一个server process使用相同User Data Root时能读相同Macro，却拥有独立Room列表、32个Room上限与runtime。

### restart 与 Destroy

用户关闭随机Room URL的所有页面后重新打开同一URL，server尚未停止，因此仍连接原generation。即使目标Room正在运行Macro，用户也可从Home确认Destroy；request携带清单中的expectedRoomGeneration，runner与terminal被终止，目标从列表消失。若这是最后一个Room，当前Home显示empty state而不自动重建。Ctrl+C直接走destroyAllRooms并清空该process全部Room。以后访问旧URL在容量允许时创建同token的新空generation；旧Trace仍可读但Resume返回run_not_active。

### Room capacity

当前已有32个live Room时，GET /显示Home且New disabled；进入任一已有/<roomId>仍正常。POST /api/rooms或直接访问不存在但格式合法的/<roomId>返回room_capacity_reached并保持32个Room不变。用户Destroy一个generation后，Home显示31 / 32，下一次New可创建新Room。两个并发New只能有一个在最后一个slot上成功。

### 失败反例

* /r/main或/r/experiment：旧route/固定名称非法，不创建Room。
* /not-a-room、/r_short、/room_short：不符合current generated Room ID contract，明确失败。
* /p/repo-a/r/main：route未注册，不推断 target project。
* /ws?configId=local：route未注册，不映射任何 Room。
* 32个Room时访问不存在的合法/<roomId>：room_capacity_reached，不隐式Destroy或复用已有Room。
* stale Home携带旧roomGeneration删除同token的新Room：room_generation_conflict，零mutation。
* 外部terminal执行just codex：shell_deck_room_context_required，Codex不启动且不产生unbound evidence。
* legacy notification-profiles.json包含Telegram token：按raw bytes迁到target并继续server-only读取，不能被Server Profile清理规则删除。
* legacy与target notification config内容不同：notification_config_path_conflict，两个文件都不覆盖。
* .032中尝试调用新的Macro Duplicate/Clone：route不存在；完整Macro CRUD直到.034才cutover。
* 指定不同 cwd 的两个 Shell：合法，不拆成两个 Room。
* production Shell中执行命令：可进入用户全局history；同一命令由integration/E2E fixture执行：只进入该Shell进程in-memory history，不得出现在`~/.bash_history`。
* 在某个 repo 下启动 server：不注册该 repo，不把它作为 Shell 默认 cwd，不在其中写 .shell-deck。
* 旧 Directory Library 文件：不扫描、不迁移。

## 测试规范

### Unit / store

* User Data Root resolution、显式root isolation、0700 directory/0600 file与atomic temporary mode、existing broad-permission warning、notification symlink/non-regular/broad-permission fail-closed，以及产品级server profile/config/project inputs fail loudly。
* notification legacy/target path矩阵、raw-byte identity、atomic relocation、identical cleanup、different-content conflict、target-only read、init命令新路径和secret不进入API/Trace；两个不同cwd/process并发迁往同一target时只有一个winner，loser source保留且notification subsystem稳定unavailable；relocation source/target permission不合法时不复制、不删除、不泄漏bytes。
* fixed paths、terminal cwd零写入、MacroRecord primitive/Library/Trace/notification ownership。
* generic MacroRecord envelope、server-generated metadata、opaque definition、canonical path-derived resource transaction、lock/crash recovery、phase-aware atomic replace/delete、post-publish authoritative reconciliation、optimistic conflict与second-process read-after-write；故障注入覆盖rename/unlink已生效而parent-directory fsync失败，调用方仍只得到一次成功mutation；不要求.032 production Macro API可运行。
* short-uuid v6 helper唯一import、22位Base58/UUID round-trip、decoded UUID v4/RFC variant、prefix矩阵、全部factory与严格旧格式拒绝。
* Room ID格式/entropy、server-generated Root/Home identity与direct URL route-token唯一例外、zero-room GET /创建并302、existing-room GET /返回Home、并发首建single winner、target lazy create、32容量guard、live list、collision retry、generation-bound active-run Destroy/revisit、same-token cross-process isolation和destroyAllRooms cleanup。
* Shell explicit/default cwd、Text no-cwd、invalid path、drag不改变terminal identity/process、current cwd probe/update event，以及New shell server-side跳过Text并继承最高index Shell live cwd、零cwd dialog/零cached path、无Shell/probe failure时`$HOME`。
* Room/terminal/Text/output-activity revision单调性；满replay tail中等长持续output仍推进activity；旧snapshot/delta不回滚新truth；Text `a -> ab -> a` delayed own-echo仍保留最后一次edit并重发latest generation。
* PTY runtime directory、bin/etc与helper/bashrc拒绝symlink/non-owned/non-private path；helper不信任mtime、只经verified unique temporary + fsync + atomic rename安装。
* PID record strict current schema、start-time/argv exact match、PID reuse、`/proc`读取失败fail closed、zombie/stale cleanup和真实server SIGTERM cleanup。
* tab/header共用canonical单行label、Text省略cwd、实时cwd/status更新、overflow tooltip、header selectable及terminalId不重复。
* browser localStorage current/invalid v2 schema，且不存在`autoPrepareTerminals`。

* Room-scoped ingest context、membership/launch校验、external just codex拒绝，以及global ingest/manual identity/spool/unbound旧路径失败。
### Protocol / integration

* /的zero-room redirect与existing-room Home双态、valid/invalid token、POST New、direct-token ensure、capacity conflict，以及removed /r/main/Project/config/Server Profile routes。
* same-user multi-device顺序操作时input/output/replay/lifecycle同步；防御性queue/revision面对意外重叠请求不损坏状态，但不把并发操作作为positive workflow。
* delayed RoomSnapshot/terminal snapshot/replay、frame-batched cross-terminal output与Text own-echo均按server revision单调收敛；满2 MiB replay tail时持续等长output不会被误判为无activity；离线PTY query fixture证明live DA/cursor/OSC color响应仍可达，而切换Shell/Text导致的历史replay hydration连续三次均产生零`terminal_input`。
* different Room/process zero terminal/run leakage；user content mutation向发起process的全部connected clients广播，不按Room或已删除scope过滤。
* 两个 process 共用 root 时 Macro/Library/Trace read-after-write 共享，Room 不共享。
* browser disconnect/navigation不销毁Room；Home GET list只枚举本process；New/Destroy/capacity串行，stale generation DELETE零mutation，active-run Destroy终止目标；Ctrl+C/SIGTERM清理全部Room；restart创建新generation。
* barrier强制Destroy分别与持有content/structure guard、PTY spawn、terminal publish、Prepare queue、Start manifest fsync、run_started append和in-memory run install交错：destroying先发abort/cancel而不死等guard，在途ticket于await后退出并清理，map removal后零terminal/run resurrection；已durable provenance明确终止且不能恢复。
* Room WebSocket 与 API path 冻结 context，payload 不能伪造 roomId。

* AgentEvent path冻结Room context，token/roomGeneration/terminalId/launchId任一不匹配均fail loudly且不落盘。
### Browser E2E

* zero-room root redirect、existing-room Home、canonical /<roomId>地址、Room identity indicator与Room页新标签Home按钮；UI不存在Rooms (N)菜单和产品级Copy Room URL。
* 同一用户两个tabs/devices打开同一URL同步观察并顺序接续；Home在当前页New/Open，显示N / 32并在capacity达到时禁用New。
* 不同 Room 看到同 Macro list，但 selected Macro 与 UI preference ownership 符合 contract。
* 一个Room中多个不同cwd的Shell可并存；某Shell执行`cd ~/temp`后tab/header同步新cwd，New shell不弹路径框并从server-side最高Shell index继承该live cwd；只有Text、空Room或probe不可用时使用`$HOME`。
* cwd目录没有`.shell-deck`；reload后current browser settings保留且不存在terminal Prepare setting。
* Close/Leave保留runtime；Home可Open/Destroy任一live Room；active-run Destroy、最后Room empty state、被Destroy client回Home、stale generation、旧URL重访与capacity语义正确。

### Gate 与残留扫描

* 新增just test-032聚合user-root/shared-store/notification relocation/MacroRecord primitive/Room/routing/multi-client/cwd/browser tests；Room controller/content edit lease测试从.033开始，production Macro CRUD/editor/runner测试从.034开始。
* `.031B`的202-source/239-runtime历史baseline保持不可变；本task必须保留`just test-031b`入口，并在本workspace维护current source snapshot与current UI-only journey。因本contract明确消失或新增的每个runtime control都要写`changedBy: 20260627A.032`、old/new behavior与spec归属；Macro/Prompt/Run中间态移除、fake terminal和alias/rename删除属于预期变化，Room/Home与current terminal controls属于预期新增。任何surviving control失败或无归因差异均为代码漂移，禁止通过删测试处理。
* 运行just check、just build、just test-unit、just test-032、current browser Gate和git diff --check；把.002-.031中仍有效的PTY、Room sync、replay/backpressure、notification与parser断言迁入current suite。依赖旧config/Deck/Macro V2的历史recipe/test source一并删除，不以跳过或broken command伪装通过；.034以MacroDefinitionV3重新建立Macro integration Gate。
* rg扫描executable source/current tests/active docs中的direct short-uuid import、translator.new、random/truncated/counter entity ID、term_abc/r_<21-char> positive fixture，以及configId、ProjectRecord、TerminalDeck、旧routes/PromptStore/UiLayoutStore、term_manual/launch_manual、spool import、unscoped AgentEvent ingest、notification dual-read和Macro duplicate/clone route；只允许generatedId模块、明确negative fixture或notification relocation source constant。审计所有Room async mutation都通过lifecycle admission/ticket，所有User Data Root create/replace都显式设置frozen mode。
