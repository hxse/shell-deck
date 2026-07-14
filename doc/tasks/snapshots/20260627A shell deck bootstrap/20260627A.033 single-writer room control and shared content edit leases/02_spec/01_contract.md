# Contract

## 任务边界

本任务冻结两个正交的single-writer primitive：live Room controller与user-global content edit lease。它们必须由server在每个mutation入口重新验证；UI只显示server truth。

交付停止线：

* 每个serverInstanceId + roomId + roomGeneration精确拥有零个或一个controller。
* 第一个完成Room WebSocket握手的client在没有controller时原子取得控制；后续clients为observer。
* owner server process必须基于Room WebSocket ping/pong每10秒renew controller，lease TTL精确为30秒；browser timer、visibility或focus不承担authority。disconnect主动释放，crash/失联最迟在TTL后释放。测试使用fake clock，不依赖wall-clock sleep。
* observer对所有shared Room mutation得到稳定错误，不能只在UI隐藏按钮。
* Take Control原子替换旧controller且必须携带用户确认时看到的expectedControlEpoch；旧client立即变为observer，任何已在途但尚未commit的mutation都必须在commit前复核Room lifecycle/generation/control epoch。
* 一个user-global Macro/Library saved record同时最多一个edit lease，跨Room和多个server process生效；不同record可并行编辑。leaseEpoch只在owner取得/替换时递增，content takeover必须绑定用户确认时看到的expectedLeaseEpoch。
* owner server process对active editor持有的content edit lease同样每10秒renew、TTL 30秒；Save/Delete同时要求valid editLeaseId与expected revision，并与lease transition共用.032 per-resource transaction guard。
* controller/edit lease均不从日志恢复；controller不写长期文件，edit lease协调文件只属于crash-expiring lock state，不是产品内容。
* just check、just build、just test-unit、just test-032、just test-033、browser multi-tab Gate、two-process Gate与git diff --check为阻断项。

Macro/Library具体CRUD、draft、validation与运行规则不在本任务重复定义；.034/.036必须逐字消费这里的identity、lease与错误contract。

## UI精准重构边界

本任务不是工作台视觉重做。`.032`当前Room topbar、terminal tab/pane、New Shell/Text、Settings与Home行为是直接实现基线；`.031`中仍有效的Macro工作台布局、控件视觉语言和编辑交互是后继接入参考。两者都不是旧schema/API来源。实现single-writer只允许下列必要UI变化：

* 在既有Room topbar可容纳的位置显示`Control: This device`、`Read-only · Take control`或`Reconnecting · Read-only`，并提供Take Control确认。
* 从server truth统一派生shared mutation control的disabled/inert/aria状态和明确错误；observer仍保留查看、scroll、selection、collapse、Copy及browser-local preference。
* 为.034/.036提供无业务布局假设的controller/content-lease state primitive、notice与确认能力；具体Macro/Library按钮位置由对应task接入。

允许为上述状态做最小spacing或responsive调整，并复用现有button、popover、notice、disabled样式。默认保护范围包括terminal label/排列、工作台panel比例、Macro editor层级、toolbar密度、icon语言、配色、字号和与single-writer无关的交互；不得通过隐藏整个panel、清空draft或重建另一套chrome来实现readonly。没有截图/像素对照Gate，但实现前必须在execution记录实际触及的UI文件及每个文件的controller/lease理由；review逐项说明有意偏离。无contract理由的UI diff必须移除。

## Room controller

### Identity与状态

Room连接握手由server生成clientId并只返回给该连接。广播与owner capability使用两个不同对象：

    type RoomControlView =
      | { mode: "available"; controlEpoch: number }
      | { mode: "observer"; controlEpoch: number; expiresAt: string }
      | {
          mode: "controller"
          controlEpoch: number
          expiresAt: string
        }

    type RoomControlGrant = {
      clientId: string
      controlLeaseId: string
      controlEpoch: number
      expiresAt: string
    }

RoomControlView是当前接收者视角：只有owner看到mode=controller；其他连接看到observer，但看不到owner clientId、controlLeaseId、设备指纹或用户身份。RoomControlGrant只通过owner handshake/acquire/takeover response返回给当前owner，绝不进入observer broadcast、Room list、Trace、error或localStorage。controlLeaseId使用统一generated ID factory。controlEpoch是Room generation内从0开始的monotonic integer：fresh generation的available为0，每次client取得owner身份（首次handshake acquire、显式acquire或takeover）递增一次；release/expiry只转为available并保留当前epoch，下一次acquire再递增。它不是持久化identity。clientId、leaseId与epoch都不能由request body伪造或复用到另一个Room/generation。

fresh Room generation中，第一个完成有效Room WebSocket握手的client在server lock内从available epoch 0转为controller epoch 1并单独收到grant。其他client只收到observer view与“由另一设备控制”的只读状态。controller主动release、disconnect或TTL失效后进入available并广播；已有普通observer或以后新连接都不得被server自动提升，任一live observer必须显式调用acquire并携带自己看到的expectedControlEpoch，同一epoch只有一个atomic winner。唯一UI连续性例外是：同一browser tab在reload或短暂WebSocket重连前已持有controller时，可保存一个不含clientId/controlLeaseId/controlEpoch的session-scoped ownership-intent marker，并在5秒bounded window内等待server广播available后自动调用正常epoch-bound acquire。它不得在observer状态调用takeover，不得跨tab/localStorage持久化grant，不得抢走仍存活或已被其他设备取得的controller；窗口过期、收到room_control_lost或acquire conflict后必须清除intent并保持显式Take Control。server每10秒对连接做ping/pong；owner连接仍responsive时由server内部刷新controller expiresAt，并续该client当前active content leases。browser不调用renew HTTP。WebSocket正常关闭时server尽力立即释放controller及该connection的content leases；half-open、owner process crash或失联停止server renewal并依赖TTL。

### Server-side mutation guard

以下shared Room mutation必须经过同一guard，不允许模块各自实现不一致判断：

* Shell/Text terminal create、insert、delete、reorder、restart与其他lifecycle mutation。
* Shell terminal input、paste、ending sequence与Text terminal内容修改。
* Macro面板显式`Prepare terminals`请求；Macro selection本身是client-local，不在guard内且不得隐式触发Prepare。
* runner Start、Pause、Resume、Stop与人工runner input/decision。
* saved Macro/Library Edit lease acquire、Save、Delete与其他user content mutation。

server内部runner action、PTY output/lifecycle callback、timeout、capture completion与shutdown cleanup不是client mutation，不要求browser lease，但必须验证它们自己的roomGeneration/run token。只读API、Trace、output/replay、Copy、scroll/collapse、selected terminal、selected Macro、panel width/visibility、filter与其他versioned localStorage preference不要求controller；这些local operation不得隐式发出Prepare。.032 Room Home的New/Destroy是server process lifecycle management，不属于Room mutation guard；Destroy仍必须校验expectedRoomGeneration并走Room manager queue。

统一guard的最外层必须先取得.032 active Room lifecycle ticket，再验证controller；lifecycle gate先于terminal structure lock或content resource transaction guard。任何await后及commit/publish前同时复核ticket、roomGeneration、controlEpoch与controlLeaseId。Room进入destroying后关闭新admission并abort既有ticket，因此旧grant即使TTL尚未到期也立即不可用于新mutation，在途operation也不能在Destroy后提交或复活Room state。

HTTP Room mutation必须携带owner-only RoomControlGrant中的X-Shell-Deck-Client-Id、X-Shell-Deck-Room-Control-Lease与X-Shell-Deck-Room-Control-Epoch。这三个header共同构成owner-only bearer capability；HTTP transport本身不提供tab/channel binding，若真实header在原owner WebSocket仍有效时被逐字复制，server无法也不承诺区分复制者。产品安全目标是防止同一用户多设备的意外并发操作，不把grant表述为认证、不可转移secret或多人访问控制。

server仍必须逐请求确认bearer对应当前process中目标Room/generation的live owner WebSocket、current controlLeaseId/controlEpoch、未过期controller与active lifecycle ticket；伪造、缺字段、expired、stale epoch、wrong Room/generation、owner WebSocket失联或Room destroying均失败。非Room-path Macro/Library mutation同样由clientId与grant反查server-verified Room context，不接受body roomId。WebSocket mutation使用握手绑定的clientId，并在处理和commit前各校验一次当前controlLeaseId/epoch。Take Control/acquire本身不要求旧lease，但caller必须是目标Room当前live connection，并携带下节的expected epoch。first-party browser不得把grant写入localStorage、URL、日志、clipboard或展示给用户。

### Take Control与丢失控制

UI顶栏显示以下互斥状态：

* Control: This device
* Read-only · Take control
* Reconnecting · Read-only

跨设备或普通observer的Take Control必须显式点击。若旧controller仍有效，UI先说明“这会让另一设备立即只读，并撤销它在本Room取得的内容编辑租约，未保存草稿可能无法保存”，并冻结该对话框打开时看到的expectedControlEpoch；确认request exact body为{ expectedControlEpoch, confirmed: true }。confirmed缺失或不为literal true返回room_control_takeover_confirmation_required且零mutation。server在单一critical section再比较当前epoch，epoch不等返回room_control_epoch_conflict且零mutation，不能把旧确认应用到后来owner。上一节同tab bounded reload/reconnect只允许在available状态调用普通acquire，不属于Take Control且不显示takeover确认。匹配后：

1. 递增controlEpoch并签发新controlLeaseId。
2. 撤销旧controller通过该Room持有的content edit leases；跨process lease文件删除失败时至少写入revoked epoch，旧owner的renew/Save仍必须失败。
3. 向旧client发送room_control_lost与observer view，新client单独收到controller view和新的owner grant。

available状态下/acquire同样使用exact body { expectedControlEpoch }；只有current mode=available且epoch匹配才能取得controller并递增epoch，其他请求返回room_control_held或room_control_epoch_conflict。owner DELETE /control使用当前bearer、exact empty body，成功后转available但不自动选择observer。Take Control只适用于current mode=controller；UI不得用持续变化的expiresAt作为确认版本。

旧client的本地draft不得被清空，仍可查看和Copy，但Save返回content_edit_lease_lost；恢复写入必须重新取得Room control和record edit lease，并按最新revision处理。

### Room Home lifecycle exception

.032 Room Home不是Room connection，不取得或复用任何Room clientId/controlLeaseId。Home New和携带expectedRoomGeneration的Destroy属于server process lifecycle management，明确排除在controller guard外；Destroy先按.032在Room manager中原子进入destroying并关闭admission，立即发送abort/cancel，再撤销目标controller及其content leases、drain operation ticket，最后执行runtime cleanup。它不得先等待content transaction guard再发送abort。产品不存在跨RoomTake control & destroy、controller token复用或observer借用target identity。

active run、Paused或Stopping都不能禁止Home Destroy。Ctrl+C、SIGTERM、normal server stop与内部destroyAllRooms同样无需browser controller，并销毁该process全部Room。除这条明确lifecycle exception外，任何target Room shared mutation仍必须由其controller发起。

## User-global content edit lease

### Canonical resource key

支持且只支持以下resource key：

    { kind: "macro", itemId: "tmpl_<generated>" }
    {
      kind: "library"
      itemKind: "macro-template" | "prompt" | "note"
      itemId: "lib_<generated>"
    }

Library canonical identity为(itemKind, itemId)；Macro identity为(macro, itemId)。roomId、serverInstanceId、selected tab、title与path都不参与key。非法kind/ID按current schema fail loudly。

### Acquire、server renew、release与takeover

取得saved record的Edit模式前，client必须先控制当前Room，再请求content edit lease。对每个canonical resource保存一个非secret monotonic leaseEpoch：初始available为0，每次acquire或takeover产生新owner时递增，renew不变，release/expiry/revocation转为available并保留当前epoch。held lease状态至少包含resource key、leaseEpoch、editLeaseId、serverInstanceId、roomId、roomGeneration、clientId、controlEpoch、baseRevision、acquiredAt与expiresAt；safe view只暴露mode、leaseEpoch和必要expiry，不暴露owner或editLeaseId。

lease state存放在<user-root>/.locks/content-edit/下，但它不是第二把resource lock。每次acquire、owner-server renew、release、takeover以及record update/delete都必须先把canonical resource key映射到.032规范化record path，并取得同一个per-resource transaction guard；在guard内重读lease state、判断TTL/revocation/revision并atomic replace。不得让lease transition与record commit各拿一把互不协调的锁，也不得在整个编辑会话长期持有OS file lock。expired/crash held state在TTL后原子转为available tombstone并保留leaseEpoch；只要record仍存在就不能删除或重置该epoch，record成功Delete后才随同一guard清除tombstone。它只用于防旧确认ABA，不是产品history或可恢复editor。

规则如下：

* foreign valid lease：打开record仍可读/Copy/Run/Load，但Edit disabled并显示content_edit_lease_held。
* owner-server renew：只有owner WebSocket仍responsive、Room control/generation/epoch仍有效且client仍处于对应Edit session时刷新expiresAt；任一条件失效则停止renew并立即尽力release/标记失效。browser没有authority renew入口。
* Save成功只更新record revision与editor base，当前Edit session继续持有同一lease，不能把正常Save表现为突然只读。显式Done/Cancel、切换或New其他内容、Delete成功、editor unmount、Room control丢失或Room Destroy才立即尽力release；异常终止由TTL兜底。New首次Create前没有lease；Create成功后若UI继续保持Edit session，必须对fresh record显式acquire成功后才允许下一次编辑/Save，竞争失败则保留已创建record但进入read-only并明确提示。
* explicit Take Over需要确认；UI冻结确认时看到的leaseEpoch，请求exact携带expectedLeaseEpoch与confirmed: true。confirmed缺失/非true返回content_edit_takeover_confirmation_required；guard内epoch不匹配返回content_edit_lease_epoch_conflict；两者都零mutation。全部匹配才递增leaseEpoch并原子签发新lease，旧owner后续renew/Save得到content_edit_lease_lost。不得用expiresAt绑定确认。
* available acquire携带expectedLeaseEpoch；同一epoch由per-resource transaction guard保证单一winner。release、expiry或revocation不自动把等待者提升为owner，任一controller必须显式acquire并重新读取current safe view。
* 不同resource key不互相阻塞；New未保存draft没有existing record lease，首次Create由server生成fresh record identity并走atomic create。
* lease状态不包含Macro/Library正文，不写Trace，不成为restart可恢复业务状态。

### Revision与commit复核

update/delete request必须同时提供editLeaseId与expectedRevision。server取得.032对应canonical per-resource transaction guard后按顺序重读并复核：resource key、Room controller/generation/epoch、edit lease owner/TTL/revocation、当前record revision；全部通过后在guard仍持有时完成same-filesystem atomic replace或delete。record publish之前任一变化均零写入。

record atomic replace/unlink是durable commit的唯一point-of-no-return。此前的authorization、lease或revision失败仍返回普通失败并保证零正文mutation；此后即使Room control变化、HTTP continuation延迟、record parent-directory fsync报告durability uncertain，或lease coordination文件刷新/删除失败，也不得把已经发布的正文谎报成未保存。record store先按`.032`重读核对authoritative bytes/absence；commit primitive随后返回authoritative record result与显式leaseOutcome：`retained`携带推进到新baseRevision的grant，Delete正常清理为`released`，lease-state后置步骤失败为`lost / content_edit_lease_state_refresh_failed`。`lost`表示正文已经成功Save/Delete、当前Edit session必须转只读；route仍须返回并广播authoritative saved/deleted结果，不得要求用户重试正文写入。resource-lock release或其他后置失败不得恢复旧lease、继续用旧editLeaseId提交，或覆盖正文成功结果。

takeover/acquire/renew/release也必须取得同一guard，因此不会插入“旧Save已验证lease但尚未replace record”的窗口：若旧Save先取得guard，它完成当前commit后takeover才生效；若takeover先取得guard，旧Save随后稳定读到content_edit_lease_lost。实现不得用lock ordering猜测替代这一单一事务边界。

in-flight async operation不能只在开始时检查。每个point-of-no-return之前的await/commit boundary都必须复核.032 lifecycle ticket/roomGeneration、Room controller epoch、editLeaseId/leaseEpoch和expected revision，避免Destroy、Take Control、lease takeover或新版本提交后旧response覆盖draft/store。通过point-of-no-return后不得再以post-await controller复核覆盖已经发布的成功结果；client仍须按自身operation identity决定是否安装response，不能把stale response写入另一个本地draft。

稳定错误码：

* room_control_required
* room_control_held
* room_control_lost
* room_control_takeover_confirmation_required
* room_control_epoch_conflict
* content_edit_lease_held
* content_edit_lease_lost
* content_edit_lease_expired
* content_edit_takeover_confirmation_required
* content_edit_lease_epoch_conflict
* content_revision_conflict
* content_edit_lease_state_refresh_failed（只作为成功publish后的`leaseOutcome.reason`，不能作为正文commit失败响应）

错误响应可包含安全的resource key、revision与expiry，不包含正文、secret或另一设备标识。

## API与广播

Room control endpoints：

    POST   /api/rooms/:roomId/control/acquire
    POST   /api/rooms/:roomId/control/take-over
    DELETE /api/rooms/:roomId/control

Content edit lease endpoints：

    POST   /api/content-edit-leases/acquire
    POST   /api/content-edit-leases/take-over
    DELETE /api/content-edit-leases/:editLeaseId

controller acquire exact body为{ expectedControlEpoch }，take-over exact body为{ expectedControlEpoch, confirmed: true }，release exact body为空。content acquire body为{ resourceKey, expectedLeaseEpoch }，take-over exact body为{ resourceKey, expectedLeaseEpoch, confirmed: true }；release只能使用owner持有的editLeaseId且携带current Room bearer。first-party browser没有controller/content renew route；renew由owner server process内部service调用同一transaction primitive。content endpoints必须携带当前Room path/context或等价的server-verified Room identity以及Room control grant headers；client不能用body伪造另一个Room owner。owner response可以返回自己的editLeaseId/leaseEpoch，foreign observer只得到mode/leaseEpoch/必要expiry等safe view，不暴露editLeaseId、owner identity或lease state file path。

同process通过现有WebSocket向同Room广播无secret controller view，并向相关clients广播content lease invalidation。不同process不建立live WebSocket federation；acquire、owner-server renew与Save每次都读取filesystem真值，UI在focus、显式Refresh及收到本process invalidation时刷新foreign lease view。UI刷新频率不决定lease有效性。

## 后继接入边界

* .034的saved Macro默认read-only；显式Edit取得macro lease，Save保留当前Edit session，Done/Cancel/Delete按本contract；New draft直到Create前不占已有record lease，Create后继续编辑必须取得fresh record lease。
* .036的Library item使用(itemKind,itemId)租约，默认read-only；Save同样保留Edit session，Copy、search与Load source不要求lease。
* .034/.036不得创建各自的process mutex、client lock、兼容fallback或不同TTL/error vocabulary；update/delete route必须消费`value + leaseOutcome`，先广播authoritative saved/deleted record，再按`retained/released/lost`维护editor lease。
* .034显式Prepare消费request内当前draft的validated terminalLayout snapshot，并绑定terminal structure revision；Start另外绑定saved Macro revision与terminal structure revision。content lease不能代替任一版本/快照边界。

## Legacy Kill List

实现后必须删除或不可达：

* 多个同Room clients都可mutation的positive flow。
* 只靠disabled/readonly attribute、没有server guard的写保护。
* 用clientId、selected Macro或Room URL充当content edit lock。
* 一个global mutex锁住全部Macro/Library，或在整个编辑会话长期持有OS file lock。
* lease成功后忽略expected revision、point-of-no-return前的await后不复核epoch/lease，或point-of-no-return后再用controller变化把durable success改写为失败的commit路径。
* controller/edit lease写入run Trace并在restart后恢复。
* duplicate/clone/copy-and-create作为规避lease的入口。
* 向observer、Room list、Trace或localStorage发送controlLeaseId/owner clientId，或只凭caller-supplied HTTP bearer而不验证live owner WebSocket、epoch、generation与lifecycle；反向宣称普通HTTP能识别被逐字复制且仍有效的bearer来自哪个tab同样禁止。
* browser timer调用controller/content renew route；background tab不得成为authority liveness真值。
* edit lease transition与record commit使用两把互不协调的per-record lock。
* Room顶栏/跨Room菜单Take control & destroy；Room lifecycle管理只存在于.032 Home。

## 测试规范

### Unit / protocol

* controller首次取得、第二client observer、owner-server renew、TTL、disconnect/release进入available不自动提升普通observer、显式acquire single winner、同tab reload/reconnect bounded intent只在available自动acquire、窗口过期/observer takeover/conflict清除intent，以及stale epoch与wrong Room/generation/lease拒绝。
* RoomControlView/Grant projection：observer broadcast、Room list、Trace、error和localStorage均不含controlLeaseId/owner clientId；伪造、过期、stale/wrong-context bearer失败；逐字复制仍有效bearer不作为可实现的channel-binding negative assertion。
* WebSocket保持responsive而browser无timer/focus消息时controller/content lease持续有效；ping失败、process crash或disconnect后停止renew并按TTL释放。
* 每一种shared Room mutation都经过统一guard；针对HTTP和WebSocket至少各有一个direct bypass negative test。
* Take Control缺少confirmed被拒绝、确认后撤销旧owner、expectedControlEpoch旧确认失败、在途operation commit复核、旧draft保留但Save失败；owner release后observer不自动提升。
* canonical resource key、leaseEpoch、content takeover缺少confirmed被拒绝、expectedLeaseEpoch旧确认失败、available acquire single winner、same-record exclusion、different-record concurrency、revision conflict与TTL cleanup。
* .032 Room lifecycle ticket覆盖全部guarded mutation；barrier强制Destroy发生在guard通过之后、commit之前，证明旧bearer/lease不能在destroying后提交。
* .032 canonical resource transaction/state atomicity、crash residue expiry、takeover winner与second process read-after-write；用barrier强制Save验证后暂停，证明takeover不能在record replace前穿透guard；fault injection分别证明record replace/unlink后directory fsync失败仍经authoritative reconciliation成功，以及正文成功而lease-state refresh/delete失败时返回authoritative success、leaseOutcome=lost、旧lease不可再次commit。

### Browser / integration

* 同Room两个tab：第一tab可写，第二tab同步观察且所有共享controls只读；纯local UI仍可操作。
* 第二tabTake Control后第一tab立即只读；terminal input、Text edit、terminal reorder、runner control与content edit均不能从旧tab提交。
* Room页无Destroy/Rooms菜单；.032 Home generation-bound Destroy撤销controller/leases并可终止active run，server shutdown无需browser lease。
* 不同Room可同时操作各自runtime，但编辑同一Macro/Library item只有一个winner；不同record可并行。
* 两个server process共享User Data Root时同一record lease互斥；kill owner后TTL到期可恢复编辑。
* observer可以read/search/copy/scroll/collapse；foreign-leased Macro仍可按saved revision运行，Library macro-template仍可作为只读Load source。
* controller indicator与Take Control使用既有Room chrome/notice视觉语言；observer切换只改变写能力和状态呈现，不改变terminal label、panel编排或清空任何draft。使用DOM/行为断言，不要求截图像素比较。

### Gate

* 新增just test-033聚合controller、content edit lease、multi-tab与two-process tests。
* `.031B`历史baseline与`.032`source snapshot保持可读；本task的current inventory必须加入`take-control`并归属`.033`，同时为terminal create、Shell input、Text edit、tab drag与close的controller-only变化建立semantic attribution。current UI-only journey必须覆盖原controller tab reload后bounded automatic acquire、普通observer不自动提升、observer可读/local controls、takeover取消与确认、旧controller notice/readonly、新controller继续edit/drag/close；若测试发现selected terminal等与single-writer无关的漂移，必须回到拥有该contract的前序task修代码。
* 运行just check、just build、just test-unit、just test-032、just test-033、受影响历史Gate、browser Gate与git diff --check。
* rg扫描client-only lock、unscoped mutating endpoints、public renew route、observer secret projection、caller-header-only authority、虚假HTTP channel-binding保证、缺失expected epoch的takeover、自动observer promotion、独立lease/record lock、跨RoomTake control & destroy、duplicate/clone、global content mutex、lease-as-revision与persistent Room controller残留。
