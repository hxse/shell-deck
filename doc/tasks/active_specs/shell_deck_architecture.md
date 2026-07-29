# Shell Deck Architecture

## 当前边界

shell-deck 是一个 local-first、terminal-first workspace。一个 server process 可以承载多个由 `/<roomId>` URL 选择的 live Room；同一用户可通过多个标签页或设备连接同一 Room并同步terminal state，但server强制一个Room同时只有一个controller，其他连接只读观察。产品不建立多人协作或Project/target-directory模型。

Room、terminal、Text content、replay、client、runner cursor 与 run snapshot 都只存在于当前 server process。长期 MacroRecord、Trace/artifact、AgentEvent evidence和notification config位于同一 OS 用户的 User Data Root，不与 Room URL、server cwd 或 Shell cwd 绑定。MacroRecord是唯一saved user-content domain。

## 路由

* 零 Room 时 `GET /` 原子创建随机 Room 并 `302` 到 `/<roomId>`。
* 已有 Room 时 `GET /` 显示 Home；Home 可列出、New、Open、Destroy，固定容量为 32 个 live Room。
* canonical WebSocket 为 `/ws/rooms/:roomId`；canonical Room API 为 `/api/rooms/**`。
* 合法旧 URL token 可 lazy-create 同 token 的新 generation；server restart 或 Destroy 后不恢复旧 runtime。
* `/r/**`、`/p/**`、`/api/configs/**`、`?configId=` 与旧 `/ws?configId=` 均未注册。

被 Destroy 的 Room page 收到 `room_destroyed` 后用 browser history 在本地切到 Home并读取 `/api/rooms`，不重新请求 `/`；因此最后一个 Room 被销毁时 Home 可以稳定显示 empty state。用户主动 reload 根 URL 时仍执行零 Room 自动首建。

## 生命周期与隔离

Room identity 是 `serverInstanceId + roomId + roomGeneration`。生命周期为 `active -> destroying -> destroyed`。所有 Room mutation 先取得 generation-bound ticket；Destroy 先关闭 admission 并 abort，再 drain 已取得的 ticket，最后关闭 PTY/client 并移除 Room，因此异步操作不能在销毁后重新发布 terminal 或 run state。

Room runtime message只广播到同一Room。Room controller是process-local memory state并随generation销毁；shared mutation先取得lifecycle ticket，再验证owner control epoch/lease。Home lifecycle管理是唯一不要求目标Room controller的外部入口。

server实现中`TerminalRoomManager`是Room/terminal domain的唯一公开facade、map owner与composition root，并创建唯一`rooms/clients` registry。`roomRegistryLifecycleCoordinator`持有相同reference，只负责create/list/lookup/admission/Destroy；control-lost和terminal cleanup经manager ports进入。`roomControlCoordinator.ts`只组合presence与lease：presence coordinator负责client lifecycle/heartbeat，lease coordinator唯一转换controller epoch/owner并提供controlled ticket。`terminalBackendCoordinator.ts`保留terminal structure transaction与发布顺序，只组合candidate/callback/close lifecycle和CWD resolve/timer lifecycle；这些helper始终操作同一live `TerminalSlot`，不缓存runtime真值。这些internal coordinator通过显式ports操作manager拥有的同一`RoomRuntime`/`TerminalSlot`对象，不建立shadow map或第二份state；production consumer继续只import`terminalRoomManager.ts`。

浏览器之间从不直接同步。terminal、runner、runtime input和notification全部先进入server-owned Room state，再由Room WebSocket投影到各连接；关闭browser不会停止server runner。Macro selector和未保存draft保持browser-local，saved MacroRecord通过user-global store与content invalidation同步，不能与Room runtime混成一份状态。

浏览器Room Workspace实现中，`createRoomWorkspaceState`继续是全部Svelte rune与public return的唯一owner，并继续创建`TerminalRoomClient`与effects。`RoomWorkspaceMessageCoordinator`只按generation/revision顺序把ServerMessage路由到factory commit ports及既有runner/notification projection；`RoomWorkspaceReconnectCoordinator`只持有reconnect/reclaim timer与session control intent。两者不缓存Room snapshot、terminal list或runner snapshot，也不增加父版本不存在的continuation token：成功close probe响应保留active检查，retry保留active/roomId检查，control acquire保留原await后commit顺序。

长期user content不属于Room。saved MacroRecord由`.033`跨Room/process的per-record content edit lease与expected revision共同保护；controller和content lease是两层正交primitive，不能互相替代。

前端saved-content实现只有Macro factory拥有Svelte rune state、commit gateway与public assembly。它装配NavigationCoordinator、EditOrchestrator、MutationWorkflow及RemoteSyncCoordinator：navigation只拥有list generation并编排New/Select request phase，edit只编排lease/persist/delete/JSON/dirty Start request phase。async结果只经factory的live token/identity-aware commit ports写入；任何helper都不得缓存第二份record/draft/lease，也不得建立带feature flag的generic content session。

## Macro 与 runner

production Macro采用`MacroDefinitionV6`与`MacroRecord` envelope分层。definition只表达portable Flow、连续terminal index/type及exact assigned/unassigned logical references；record metadata由user-global store生成。Macro selection是单个browser的editor状态，新Room默认null selection，不改变Room terminal。

`macroDefinitionValidation.ts`是definition value/JSON validation的唯一production gateway；`macroNodeValidation.ts`只按source order执行body traversal及`object -> ID -> type -> actionOnly -> type-specific` dispatch。Action与Control validator同步追加同一`ValidationContext.issues`，recursive body继续经node facade进入；共享text matcher只是pure field validator，不建立第二份issue collection或partial validation入口。Visual trusted draft的persistable/runnable diagnostics在一次clone-free traversal内同时生成，同一draft revision共享结果；JSON/persistence/Start边界继续strict validate。dirty由exact path journal对immutable base增量比较，不为每次输入clone、遍历或serialize完整definition；recording Proxy在写入边界递归unwrap，不能进入唯一draft或改变node identity。

terminal layout只有用户点击Macro面板的`Prepare`才会调整；Settings、selection、Save、Start和terminal event都不隐式Prepare。相邻的confirmed`Close all`通过同一controller/structure queue批量复用terminal close并只发布最终index map，不关闭Room或删除持久化数据。Save只做portable validation。Start在authoritative structure queue内复核record revision、terminal structure revision、type与readiness，并冻结完整definition及index到terminalId/launchId映射；运行中不重读record或live index。

runner把manifest、append-only events和typed text/JSON artifacts持久化为只读Trace evidence，但cursor、Pause/Resume状态、pending input、pending structured Capture、run snapshot和structure lock只在live process内。日志从不恢复runner。live Runner在Start时建立并复用唯一deep-frozen definition projection，普通delta只发送mutable state/new events并以revision加full logical-state hash验证；action HTTP只返回compact ack。Trace通过derived room/run index先分页summary，再按selected run分页event；多server process以`.locks/trace-index.lock`合并index。每个process/run首次从summary或event入口访问都会验证并修复stale summary，warm summary不读取segment，warm event page只读覆盖页的segment，不再聚合扫描所有run与event tail。

`LogStorageRetention`唯一拥有`runs/ + agent-events/` logical-byte quota、`.locks/log-storage-gc.lock`、current-run process pin与GC顺序，但不缓存usage truth。默认2 GiB达到limit后fresh scan：先让MacroRunStore按authoritative terminal summary atomic tombstone并删除oldest whole run，再unlink oldest closed AgentEvent segment，直到精确90%整数水位。统一admission让同一GC lock覆盖scan到durable publish；manifest/artifact、run event/summary、AgentEvent line及Trace index cold rebuild不能脱锁增长。Trace publication固定使用quota → trace锁顺序，并在GC后从剩余manifest重新计算。MacroRunStore继续唯一拥有run candidate/delete/current Room pin gateway，AgentEventStore继续唯一拥有indexes/waiters，internal segment storage只管理8 MiB JSONL rotation与带close mtime的open/closed rename。active/interrupted/current Room run或open segment不因mtime删除，quota不足统一fail loudly。

Shell启动时除AgentEvent hook context外还注入structured-result URL、同一memory-only ingest token与当前checkout canonical `SHELL_DECK_JUSTFILE`。`just -f "$SHELL_DECK_JUSTFILE" submit-json`从stdin提交当前Room generation与terminal launch的JSON；现有HTTP server按token、exact body、path Room/membership顺序只交给该Room live runner当前唯一matching waiter，不增加端口、step id或queue。Capture冻结JSON Schema 2020-12，成功后产生typed `captured_json`；JSON If通过JSON Pointer与typed matcher消费。Send/Notify message、Input default、Extract Text与`text_match`作为textual boundary可读取JSON，并统一得到key排序、compact、无末尾换行的canonical JSON；这不产生第二份text artifact。Parallel pane可把lane-local artifact通过显式Send append到Text，Parallel自身不产生merged artifact。

正常runner UI不polling。连接/重连收到完整、revisioned/hash-verified runner snapshot，后续状态由server push增量并在合并后验证全量state hash；Running Macro是Room共享的冻结只读配置，不覆盖各browser本地正在查看或编辑的Macro。runtime input draft也由server内存持有并在single-controller takeover后继续。Text full projection以monotonic token隔离异步hash，reset/reconnect后的旧结果不得覆盖current terminal truth。

## UI presentation

current presentation由Tailwind CSS 4与daisyUI 5提供，`src/app.css`是唯一project-authored CSS source；component没有`<style>`，xterm vendor stylesheet保持package-owned。Theme preference是browser settings v4中的local-only exact value，只在Room既有Settings提供入口，但覆盖同browser的Home与全部Room surface。Theme application不建立server API、Room message或跨browser同步。

除Theme select这一项已登记结构增量外，framework迁移不拥有DOM hierarchy、control位置、panel/layout或业务interaction变化。`just ui-style-residue`与111-case theme/viewport matrix冻结source owner、semantic state和responsive contract，具体见`ui_theme_contract.md`。

Macro visual editor中，`MacroInsertionPaletteLifecycle`是viewport placement、mount focus、Escape和trigger focus restoration的唯一实现。Flow insertion controller唯一拥有anchor/summary/flags/position/palette element/notice/move-node rune state，并通过live ports委托既有lifecycle与`updateDraft`；Flow tree controller继续拥有本域collapse/ID/structure mutation。Parallel lane的pure policy只读live参数，pure command只修改调用者显式传入的draft并返回result，stateful controller继续唯一拥有collapse/notice/confirm/selection reconciliation及既有`updateDraft` gateway。Flow Svelte parent保留exact recursive DOM/render snippet和projection wiring，Parallel parent保留lane palette state与selected-lane wiring，因此拆分不改变component hierarchy、control order或mutation gateway。

test evidence同样遵守400行边界。current comprehensive Macro仍只有一个top-level Playwright journey与同一page/context lifetime，ordered `test.step`实现按authoring/flow/runtime helper归属，state只由facade显式传入；Room large replay六个case与saved-content七个case按scenario拆为可自动发现的spec，case title/body/timeout/fault保持。`tests/ui-baseline/031B/controlInventory.ts`是稳定re-export facade，historical/current/evidence模块分别持有原array truth。inventory Gate把declared helper AST重新归属到原journey，并冻结case hash、expect/route/wait、step order、forced settings及runtime export value/order。已退出Playwright discovery且只由raw-byte hash引用的`comprehensiveUiBehavior031B.historical.ts`不再保存在current tree；需要时从`jj`历史恢复，结构化`.031B` control inventory baseline继续保留。

## Source boundary Gate

`just check`首先运行唯一`just file-size` scanner，再顺序运行UI style residue、TypeScript与Svelte检查。scanner从repo root递归发现project-authored code，覆盖root config/entry、JS/TS variants、Svelte、CSS、HTML、native C/C++、shell/Nix及其他显式source extension；`justfile`、`package.json`与`tsconfig.json`等extensionless/exact config同样进入。VCS metadata、dependency、runtime cache与build/test output不是authored source，按明确directory set跳过；不按业务path、digest、fixture、generated名称或historical名称豁免任何authored code。

每个被发现的regular source最多400 logical lines；400合法、401失败，CRLF与末尾换行按logical line精确计数。达到350且不超过400行的source进入non-blocking file-size advisory并打印path、actual、soft/hard limit，帮助在hard failure前安排拆分；它不属于TypeScript/Svelte/build warning，也不放宽400行Gate。invalid UTF-8、unreadable path、symlink、非regular entry或枚举失败都阻断，不能静默跳过。scanner及其unit自身在同一发现范围内，当前没有任何file exception。

## 启动与安全

所有入口通过 `justfile`。Production使用`sgl/sgn/sal/san`，development使用`dgl/dgn/dal/dan`；它们是Just原生concrete recipe alias，不由shell解析mode。Production recipe先构建assets，development由Vite承载HMR、Bun承载API/Room WebSocket。Local只绑定`127.0.0.1`，LAN只绑定`0.0.0.0`；Guest LAN是明确选择并打印警告的完整能力模式。Authenticated每次process生成临时token换HttpOnly browser session。全部browser HTTP/WS在Room mutation前执行同源admission；详细真值见`access_control_contract.md`。
