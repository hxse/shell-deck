# Execution Plan

## 执行状态

四个阶段均已完成，.032 Foundation Gate 已通过。下列阶段验收只记录本 task 能独立证明的 foundation contract；.033 的 lease/单写交错和 .034 的 Prepare/Start 交错不得提前算作 .032 已验证能力。

## 阶段一：identity、User Data Root 与长期内容

1. 升级short-uuid 6.0.3，建立src/lib/generatedId.ts、typed prefix矩阵、UUID-v4/RFC-variant strict round-trip validator与独立assertRoomRouteToken；迁移system-generated opaque ID并删除私有translator、截断、时间戳和counter生成器。
2. 建立唯一User Data Root resolver、0700 directory/0600 file与atomic temporary permission helper、固定path helper、按canonical record path派生的per-resource transaction guard、atomic replace与optimistic revision primitive；为.033 lease transition与record commit提供同一短事务入口。
3. 删除Project/configId/Directory/产品级Server Profile存储轴；在target-scoped cross-process lock内把notification-profiles.json从legacy path按raw bytes迁到User Data Root，处理多个cwd source的winner/identical/conflict矩阵并切断dual read。
4. 建立generic MacroRecord envelope/path/shared-store primitive，使用opaque definition测试；production Macro CRUD/schema/editor/runner cutover留给.034。把Trace/artifact/evidence迁到user-global path，不从中恢复runner。

阶段验收：ID/root/store unit tests通过；generic MacroRecord并发更新只允许一个winner；notification relocation保持bytes、跨process只允许一个target winner、冲突不覆盖且token不进入API/Trace；旧config/project/product-level Server Profile入口fail loudly。.033 必须复用本阶段的canonical resource transaction guard，并自行补lease takeover与record commit forced-interleaving测试。

## 阶段二：Room manager、routing 与生命周期

1. 将Deck/Config manager重构为server-local Room manager；live map按roomId保存roomGeneration、terminal collection、clients、replay和runner。
2. 建立GET /的zero-room首建redirect/existing-room Home双态、/:roomId、/ws/rooms/:roomId和/api/rooms/:roomId/**；path冻结Room context。
3. 增加Room Home、GET/POST /api/rooms、固定32容量guard和generation-bound DELETE；Home在当前页New/Open/Destroy/Refresh，Room顶栏只在新标签打开Home。
4. 实现active -> destroying -> destroyed lifecycle gate、generation-bound operation ticket/abort registry与Home Destroy：无需目标Room controller，显式确认后先关闭admission并发送abort/cancel，再撤销controller/leases、drain queue/in-flight operation，最后清terminal/clients/map；不得在发送abort前阻塞等待content/structure guard。
5. 让SIGINT、SIGTERM、just stop与normal close共用destroyAllRooms，验证无PTY遗留。
6. 为Room/terminal/Text/output activity建立可跨HTTP/WebSocket比较的单调revision，browser拒绝旧snapshot/delta；Text写入按terminal单在途、latest-generation coalescing收口。
7. 收紧real PTY runtime/helper atomic install与PID record process identity，symlink/owner/mode异常和`/proc`读取失败均fail closed。

阶段验收：root双态、Home list/open/new/destroy、server-generated token/direct route-token例外、并发首建/最后slot single winner、capacity、stale generation、revisit、same-token cross-process isolation和server shutdown integration/E2E通过；admitted async operation与PTY cleanup测试证明Destroy后不会复活当前Room runtime。Prepare/Start尚不存在，相关forced-interleaving由.034补齐。

## 阶段三：Room-scoped AgentEvent 与 runtime ownership

1. server启动生成memory-only ingest token；Shell create注入ingest URL/token与Room generation、terminal、launch context。
2. 将ingest改为POST /api/rooms/:roomId/agent-events；server authoritative补provenance并校验live membership。
3. AgentEvent store/query只接受当前Room/generation/terminal/launch attribution；成功事件可作为user-global只读evidence查看。真正的Macro capture waiter由.034接入，不能在.032制造临时runner。
4. just codex删除外部fallback并在缺context时先失败；删除global ingest、manual IDs、spool/import和unbound evidence。
5. cwd只留在单个Shell runtime；真实PTY暴露live current-cwd probe并以quiet-edge/snapshot刷新和轻量event同步。Room UI New shell不弹路径框、不发送cached path，只发送last-shell意图；server继承最高index Shell的live cwd且跳过Text，没有Shell/probe失败时使用$HOME；Prepare-created Shell始终使用$HOME。
6. tab与pane header复用唯一terminal display formatter，显示单行index/id/current cwd/kind/status，统一ellipsis/title并删除重复id。

阶段验收：Room scope防串线、stale launch、invalid token、外部wrapper拒绝、不同Room/process隔离和per-terminal cwd tests通过。

## 阶段四：client ownership、清理与文档

1. Room runtime只向同Room clients广播；shared content底座不拥有client selection/editor state。Macro/Library mutation invalidation分别由.034/.035随正式API接入。
2. 删除terminal alias/rename runtime、protocol和UI；terminal tab/pane header使用已冻结的canonical动态index、runtime terminalId、可选live cwd、kind与status label，terminal selector只接受id/index。
3. UI preference迁入strict versioned localStorage，删除Prompt/layout server persistence与autoPrepareTerminals；terminal Prepare归属.034 Macro面板显式Room mutation。
4. 文案统一为同一用户多设备同步、单一操作者顺序控制；本任务只建立Room/client底座，.033接管active-controller与内容编辑租约enforcement。
5. 删除Deck/config/project/profile/Directory/旧route与旧ID可达路径，更新active specs、guide、README和AGENTS技术口径。
6. 新增just test-032并运行全量受影响Gate、browser Gate、warning扫描与git diff --check。
7. 在Bun test scripts、Playwright wrapper/webServer与real-PTY integration fixture三层隔离Shell history：自动化固定`HISTFILE=/dev/null`，production保持用户全局history语义且不自动清理旧文件。

## 实施约束

* current-schema-only hard cut；除已冻结的notification raw-byte relocation外，不添加migration、alias、dual schema或fallback route。
* 先完成Room/user-store contract，再依次实现.033的single-writer/lease、.034的terminal mapping与.035的Library UI。
* 不从 Trace 恢复 runner，不持久化 Room registry，不让 shared User Data Root 变成 shared live runtime。
* notification config不是Server Profile；只迁移路径，schema/raw bytes/secret边界/Macro notify语义不变，成功后禁止legacy fallback。
* .032只验证Macro foundation，不造temporary production schema/API，也不作为standalone release candidate；.034负责完整Integration与stack/release Gate。
* `.031`只作为UI/interaction reference，不作为schema/API来源；.032删除旧panel是中间态hard cut，不授权后继无关视觉重做。后继必须建立task-local“必须改变/允许局部调整/默认保护”边界，并在review审计无任务理由的UI diff；不要求截图对照。
* server不提供Macro duplicate/clone；clipboard Copy不属于HTTP/store mutation。
* Home Destroy是显式server lifecycle management operation，不要求目标Room controller，也不受run structure lock阻止；统一lifecycle gate先关闭admission再cancel/drain在途operation，普通Room mutation仍由.033 guard。
* multi-client并发操作权enforcement明确归属紧随其后的.033；当前只提供其所需Room/client/shared-store primitive。
* 任何 cwd 行为都必须落在单个 Shell terminal 上，不能重新引入 Room cwd。
* shared content写入必须同时验证canonical resource transaction atomicity、revision conflict与跨process read-after-write；.033 lease transition不得另拿不协调的第二把resource lock。
* short-uuid只能由generatedId模块import；system ID一律typed prefix +完整22位UUID-v4 suffix，Flow局部semantic ID明确排除；caller-provided identity只允许canonical direct Room URL route token这一项。

## 验证矩阵

* focused：generated ID/v4 route token、User Data Root permission、generic MacroRecord/resource transaction primitive、notification relocation、Room Home/capacity/lifecycle manager、Destroy/admitted-operation interleaving、AgentEvent、shutdown unit/integration。
* inherited behavior：把历史Gate中仍有效的PTY、multi-client sync、replay/backpressure、notification与parser断言迁入current-schema suite；删除依赖旧config/Deck/Macro V2的recipe与test source，Macro integration测试由.034按V3重新建立。
* aggregate：just check、just build、just test-unit、just test-032、browser Gate、git diff --check。
* static：扫描direct short-uuid、legacy IDs、config/project/Deck routes、旧Rooms (N)/Copy Room URL、无capacity create、独立content record lock、external hook fallback、spool/import、notification dual-read/serialize rewrite和Macro duplicate/clone route。
