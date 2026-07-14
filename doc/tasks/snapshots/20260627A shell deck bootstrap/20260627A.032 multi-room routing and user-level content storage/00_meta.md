# 20260627A.032 Multi-Room Routing And User-Level Content Storage

## 实施状态

.032 Foundation Gate 已通过。Room/User Data Root/storage foundation 已落地并通过静态检查、生产构建、unit、integration 与 browser Gate；本 revision 按冻结边界仍不是 standalone release candidate。Room single-writer/content lease、MacroDefinitionV3 完整切换与 Library 产品功能分别由 .033、.034、.035 承接。

## 任务概括

删除 configId、Project、Directory scope 与“目标工作目录”产品模型，把 shell-deck 收敛为两条互不绑死的轴：用户级长期内容与 server 内的实时 Room。一个 server process 可以同时承载多个由 URL 选择的 Room；一个 Room 可以包含多个 cwd 完全不同的 Shell terminal，以及 Text terminal。Macro、Library 和只读 Trace 全部放在统一 User Data Root，不属于 Room，也不属于任何工作目录。

server根地址 / 是Room Home入口：没有live Room时，server原子创建一个随机room_<22-char-base58>并以不可缓存的临时重定向进入/<roomId>；已有Room时直接显示Room Home，由用户在同一页面New、Open或Destroy。每个server process最多32个live Room，达到上限后只允许进入已有Room或先Destroy再创建。Room页面顶栏不再承载Room列表，只提供在新标签页打开Home的入口。同一用户可从多个浏览器标签页或设备连接同一完整Room URL，共享terminal输出、状态与runner；产品只支持单一操作者顺序控制，不引入多人协作模型。不同Room、不同server process的runtime严格隔离。roomId只是未持久化的URL token，真正runtime identity是serverInstanceId + roomId + roomGeneration。

## 正式 task 级别及定级原因

三星任务。

本任务破坏性改变 URL、HTTP/WebSocket routing、Room ownership、terminal manager、Macro storage、run evidence path、browser preference ownership 和启动语义，并删除现有 config/Project/Directory abstractions。错误可能把输入发到错误 Room、让不同 server process 错误共享 live runtime、丢失用户长期内容或把 cwd 误当内容 scope，因此需要完整 Document Gate、协议测试、multi-client E2E 与残留扫描。

## 范围内

* deck public domain term 统一改为 Room；一个 server process 支持多个 routed Room。
* 冻结Room Home、首个Room自动创建、/:roomId、/ws/rooms/:roomId、Room API、32个live Room硬上限、Room页Home按钮和显式Destroy语义。
* 冻结 roomId URL token、direct URL lazy-create唯一identity例外、roomGeneration runtime instance与 serverInstanceId process identity的边界。
* 冻结active -> destroying -> destroyed lifecycle barrier；Destroy关闭admission、abort/drain在途Room operation后才释放runtime与容量。
* 升级到 short-uuid 6.0.3并建立唯一 generated ID模块；所有系统生成的 opaque identity共用22位UUID v4/Base58后缀，以 typed prefix区分实体。
* 引入唯一 User Data Root，保存 user-global Macro、Library、只读 run Trace/artifact 与 Room-scoped AgentEvent evidence；notification config只迁移存储路径，schema与文件字节原样保留。
* 冻结POSIX 0700受管目录、0600内容/secret/temporary文件，以及notification permission fail-closed边界。
* 同一 User Data Root 可被多个 server process 并发使用；只共享无状态长期内容，不共享 Room、PTY 或 runner runtime。
* 建立user-global MacroRecord path、envelope、canonical per-resource transaction guard与shared-store primitive；production Macro API/editor/runner不在.032单独切换，由.034连同MacroDefinitionV3一次性cutover。
* .032不引入临时Macro schema、半成品validator或兼容adapter；.032 Foundation Gate独立验证底座，但该revision不是standalone release candidate，stack/release Gate必须运行到完成Macro Integration的.034。
* `.031`是后继UI/交互的reference implementation而不是旧schema真值；本task为切断旧Macro V2而移除production panel代码，只构成允许的中间态，不表示否定其仍有效的布局、视觉语言或精调交互，也不授权.033-.035凭空重画工作台。
* 冻结 .035 必须使用的单一 user-level Library path；不再存在 Directory/Global scope。
* Shell cwd 是单个 terminal 的memory-only live runtime property：初值为launch cwd，server观察实际Shell process cwd并同步变化。Room UI的New shell不弹路径框，只发送`cwdSource: "last-shell"`意图；server按authoritative顺序选择最高index Shell并在创建前读取其current cwd，没有Shell或无法读取时使用`~`/`$HOME`。Prepare创建仍使用`$HOME`。
* terminal tab与pane header复用唯一单行display label，顺序固定为index、terminalId、可选current cwd、kind、status；两处内容一致，溢出省略，header可选择复制完整文本。
* UI settings、panel width/visibility、drag toggle等纯browser preference统一使用versioned localStorage；terminal Prepare不是setting。
* 删除产品级 configId、Project registry、projectId、Server Profile、project-local storage 和 target-working-directory abstraction；notification profile 与 parser profile 不属于该删除范围。
* 增加 routing、Room isolation、shared user store、multi-client、per-terminal cwd 与 localStorage tests。

## 范围外

* 不实现同一Room单写控制权或跨Room/process的内容编辑租约；由紧随其后的.033负责。
* 不设计MacroDefinitionV3、production Macro CRUD、terminal index/type schema、Prepare、Start validation或run snapshot；完整Macro cutover由.034负责。
* 不实现 Library record、CRUD、editor 或 Load into Macro；由 .035 负责。
* 不在foundation中制作临时Macro/Library占位UI，也不把暂时缺失的panel包装成最终简化版；后继必须按各自精准重构边界恢复正式surface。
* 不恢复 server restart 前的 PTY、Text content、terminal process、active runner、Pause cursor 或 Room runtime。
* 不让多个 server process 共享 live Room，也不实现跨 process WebSocket federation。
* 不在本任务实现跨客户端 active-controller lease、抢占或操作权 UI；.033负责把同一Room的单写控制和共享内容编辑租约变成server-enforced contract，.032只提供Room/client与shared-store底座。
* 不实现 cloud sync、认证授权、跨 OS用户同步或旧 schema migration。
* 不把 Flow node、if branch、parallel lane、terminal index等用户可读/文档局部标识随机化；它们不是系统 opaque identity。
* 不扫描或转换旧 configId、Project、Directory Library、project-local .shell-deck 数据。

## 决策归属

人工已拍板：

* 删除Project、configId、Directory scope与目标工作目录产品模型；长期内容统一进入User Data Root。
* public deck术语改为Room；/在零Room时自动创建并进入首个Room，已有Room时显示Room Home；Home统一New/Open/Destroy，Room顶栏只在新标签页打开Home。
* 每个server process最多32个live Room，不做idle TTL或自动回收；达到上限后New和不存在Room URL都返回room_capacity_reached，Destroy后释放名额。
* 同一用户多设备连接同一Room只支持单一操作者顺序控制；.033必须实现server-side controller enforcement，不能只靠UI禁用。
* Destroy始终可用，active run也可终止；Ctrl+C/SIGTERM清理当前process全部Room。
* notification-profiles.json及Telegram secret继续独立保留；只从legacy path迁到User Data Root，JSON文本字节与schema不变。
* .032只交付MacroRecord存储底座，.033先建立Room controller与跨Room/process内容编辑租约，.034再原子切换MacroDefinition/API/editor/runner；不制造可运行的中间schema。
* Macro最终API只保留CRUD，不存在duplicate/clone；旧config-scoped duplicate route随旧路由删除。
* 外部terminal的just codex缺少Room context时直接拒绝，不保留unbound evidence。

AI可直接实现：

* multi-Room routing/registry、ephemeral generation、Room isolation与multi-client同步。
* User Data Root permission、MacroRecord/shared content store、canonical per-resource transaction guard、generated ID/route-token validator、browser-local preference与Trace ownership。
* notification config的byte-preserving relocation、冲突检测、单一新路径读取与secret边界验证。
* Macro foundation/Integration Gate拆分、.033单写/编辑租约交接，以及旧duplicate/clone route残留扫描。
* Room Home/New/Open/Destroy、Room lifecycle admission与operation drain、Room页Home按钮、capacity guard、shutdown cleanup、Room-scoped AgentEvent验证与全部自动化Gate。
* Project/config/Directory/Server Profile旧产品路径的current-schema-only删除。

需要人工拍板：无。
