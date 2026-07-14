# 20260627A.033 Single-Writer Room Control And Shared Content Edit Leases

## 任务概括

在.032的multi-Room与User Data Root底座上，为同一用户的多标签页/多设备同步建立真正的single-writer约束：每个live Room任一时刻只有一个controller可以修改共享Room状态，其他连接只观察；user-global Macro与Library record则通过跨Room、跨server process的per-record edit lease避免同时编辑。controller与edit lease都由server强制，client disabled state只负责呈现，不承担正确性。

本任务只建立通用控制权、租约、协议与UI状态，不定义Macro terminal schema、Prepare/Start算法或Library内容模型。.034把Macro editor/runner接入该机制，.036把Library editor接入该机制。

## 正式 task 级别及定级原因

三星任务。

本任务覆盖Room内全部mutation入口、HTTP/WebSocket身份绑定、跨process共享内容互斥、takeover、crash expiry与多设备UI。一处漏检就可能让两个页面同时向terminal输入、覆盖同一Macro/Library record或在失去控制后继续运行旧请求，因此必须具备完整协议矩阵、multi-tab E2E、two-process integration与残留扫描。

## 范围内

* 每个live Room建立memory-only controller lease；第一个有效Room WebSocket client自动取得控制，其他clients进入read-only observer状态。
* controller lease精确绑定serverInstanceId、roomId、roomGeneration、clientId与controlLeaseId；owner server process用WebSocket ping/pong驱动10秒renew与30秒TTL，browser timer不承担authority。
* server端统一拦截所有共享Room mutation；observer仍可查看、滚动、复制和修改纯client-local UI preference。
* 提供显式Take Control；原controller收到room_control_lost，后续mutation稳定失败。
* 同一browser tab若在reload或短暂WebSocket重连前就是controller，可在5秒bounded window内仅对server已广播的available状态自动调用epoch-bound acquire；只保存session-scoped ownership intent，不保存grant，也绝不自动takeover仍存活的controller或提升普通observer。
* 对Macro与Library record建立user-global、跨Room/process的per-record content edit lease primitive，canonical identity不依赖Room或server URL。
* edit lease与optimistic revision同时生效；租约解决“谁可写”，revision解决“写入的基线是否仍然有效”。
* Save只提交新revision，不结束当前Edit session，也不释放edit lease；显式Done/Cancel、切换/新建其他内容、Delete、Room control丢失、组件离开或Room Destroy才释放。New首次Create若继续保持可编辑，必须先取得fresh record的lease。
* 冻结owner-only RoomControlGrant、observer-safe RoomControlView、controller/edit lease API、错误码、UI只读状态、takeover确认、TTL与cross-process filesystem coordination。
* 冻结HTTP grant为owner-only bearer capability，并逐请求校验live owner WebSocket、epoch、Room generation与lifecycle；不虚构普通HTTP的tab channel binding。
* controller与content takeover分别绑定expectedControlEpoch/expectedLeaseEpoch；release/expiry后只进入available，不自动提升普通observer或等待者；前述同tab bounded reconnect acquire是唯一UI连续性例外。
* 增加same-Room multi-tab、different-Room、two-process、takeover、expiry与server-side bypass测试。
* UI只增加controller状态、Take Control确认、server-truth readonly/busy/error呈现，以及供.034/.036复用的lease状态primitive；沿用.032当前Room chrome和.031既有工作台视觉语言，不借single-writer重排terminal、Macro或Library surface。

## 范围外

* 不建立多人账号、成员、角色、权限、presence、聊天或协作编辑模型；所有连接仍视为同一用户的设备。
* 不让多个clients并发编辑或合并同一draft，不实现CRDT/OT。
* 不持久化Room controller，不从Trace恢复controller；server restart创建新Room generation并清空控制权。
* 不定义MacroDefinitionV3、terminal index/type mapping、Prepare、Start、run snapshot或Macro draft lifecycle；由.034负责。
* 不定义Library kind/content/search/Load语义；由.036负责。
* 不把browser localStorage preference纳入Room controller；它不修改共享状态。
* 不建立cross-process live Room federation；跨process只协调user-global record edit lease。
* 不引入旧并发行为兼容开关、client-only fallback或全局单一内容锁。
* 不重新定义.032 Room Home、capacity或generation-bound lifecycle Destroy；Home New/Destroy是process management operation，不属于Room controller guard。
* 不建立新design system，不调整与controller/lease无关的panel比例、配色、字号、toolbar、terminal label或editor交互；Macro/Library具体UI分别留在.034/.036精准接入。

## 决策归属

人工已拍板：

* 同一Room只允许单一操作者；其他设备/标签页只读，不建立多人协作模型。
* 该限制覆盖页面上所有共享状态mutation，不只Macro与Library。
* 不同Room仍共享user-global Macro/Library，因此同一record也不能被两个Room或两个server process同时编辑。
* Macro Save只做portable definition validation，不依赖当前Room terminal；Start才依赖Room terminal状态。该业务边界在.034落地。
* New Room不默认选择Macro；选择/切换Macro始终是client-local且零Room mutation。只有用户点击.034 Macro面板的`Prepare terminals`按钮才请求修改terminal结构，并受本task controller guard保护。
* Room Home负责New/Open/Destroy；Home不是Room client，Destroy是显式generation-bound lifecycle management exception，不要求先取得目标Room controller。
* HTTP controller grant采用符合单用户模型的bearer capability语义，不把全部mutation改走WebSocket。

AI可直接实现：

* controller自动首次取得、显式available acquire、owner-server heartbeat、TTL、epoch-bound Take Control、owner-only bearer、observer-safe view与server-side mutation/lifecycle guard。
* per-record edit lease复用.032 canonical resource transaction guard的leaseEpoch-bound takeover、expiry、revision组合和错误码。
* Home Destroy、断线、server shutdown与内容租约释放的顺序。
* .034/.036可消费的protocol/client primitive与自动化Gate。

需要人工拍板：无。
