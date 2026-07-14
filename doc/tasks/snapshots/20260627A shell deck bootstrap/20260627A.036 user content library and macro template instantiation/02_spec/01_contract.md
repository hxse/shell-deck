# 20260627A.036 Contract

## 任务边界

本任务以.032的User Data Root、user-global content paths、shared-store primitives、generated ID factory/validator与browser-local settings，.033的Room controller/per-record content edit lease，以及.034的production MacroRecord CRUD、MacroDefinitionV3、唯一validation gateway、JSON Copy-only和显式`Prepare terminals` contract为硬前置。.036只实现Library record/store/API/UI、validator调用、Load into Macro与对称的显式`Save to Library`。

## Library UI精准重构边界

本task对UI采用“继承外壳、替换必要内部语义”的边界：

* 直接产品基线是.034交付后的完整Macro/terminal workspace；.036不得重新排列、隐藏或简化该区域。
* .031的`src/lib/components/PromptPanel.svelte`、`src/lib/components/workspace/WorkspaceShell.svelte`及仍有效的browser interaction tests是Library panel的presentation/interaction reference，不是旧schema真值。允许复用或移植组件结构、CSS和交互，但不得带回PromptStore、configId、scope、旧routes、旧record或compat adapter。
* 默认保留panel在workspace中的位置、宽度/visibility/reset-width职责，header/status、toolbar、editor、notice/error/dirty反馈的层次，既有button/input/select/textarea的视觉语言、focus/keyboard手感及与Macro panel协调的整体比例。Macro与Library顶栏入口统一使用带track/thumb和`aria-pressed`的switch button；off/on必须有明确状态差异，不能退化为普通push button。
* 必须改变且只围绕以下内容调整：Prompts→Library命名；Macro JSON/Prompt/Note tabs；kind内list/search；saved read-only与Edit/Save/Cancel；New/Copy/Remove/Refresh；controller/lease/revision/pending状态；Macro JSON行号、Validate、Load into Macro和Macro toolbar的显式Save to Library；删除scope、Duplicate/Import/Export与旧Prompt wiring。
* 为上述新增内容可以局部调整Library内部grid、toolbar换行、响应式布局、状态文案和组件拆分；调整必须复用既有workspace控件/颜色/spacing语言，并且不能扩散成全局design-system或其他panel重构。
* 默认受保护项包括Macro/terminal布局与比例、Macro toolbar和flow editor、terminal chrome、全局字体/颜色/图标、无关按钮尺寸，以及与本task无关的collapse、drag、textarea resize等交互。实现方便或.032曾临时删除UI，不构成改变理由。
* 不设截图或pixel-perfect Gate。实现前必须建立UI touch manifest，逐文件记录reference来源、保留交互、替换的wiring和必要调整理由；manifest外的UI/CSS变化是scope violation。验收使用DOM结构、控件顺序、focus/keyboard、dirty/readonly和responsive行为测试。

交付停止线：

* workspace提供Library panel，内部恰有Macro JSON、Prompt、Note三个kind tabs。
* 每个kind支持New、Edit、Save、Cancel、Copy、Remove、Refresh和搜索；saved item默认read-only，Edit/Save/Delete消费.033 lease与expected revision。
* Copy只写clipboard；失败时不显示Copied，显示clipboard_write_failed且其他state不变。
* Library不存在Duplicate/clone/Import/Export/copy-and-create API、按钮或client/store method；相似item显式走New → browser Paste → Save。
* Library是唯一user-global collection；record/API/UI不存在scope、Directory/Global/All filter或move。
* Library canonical identity是(kind,itemId)；path、revision、collision与WebSocket event都保留kind。
* storage逐字使用.032的<user-root>/library/<kind>/<itemId>.json；不建立另一data root。
* Prompt/Note content任意；Macro JSON必须是纯.034 MacroDefinitionV3，不含MacroRecord metadata。
* Macro JSON的Validate、Save和Load都把原始content直接交给.034唯一public `parseAndValidateMacroDefinitionJson`文本入口并逐字消费exact discriminated result；.036不自行JSON.parse、不拥有validator、不重排或改写issues。
* Library与selected Macro/current Room/terminal cwd独立；item update不修改已创建MacroRecord。
* Load into Macro每次调用.034 production Macro store创建fresh MacroRecord；source content不改写。Load是显式domain action，不等同于Duplicate。
* Macro toolbar提供`Save to Library`：消费当前合法visual draft并创建fresh `macro-template` LibraryItem；它不要求draft已保存为MacroRecord，也不保存/切换Macro、不清dirty、不Prepare/Start。
* clean editor且request/response operation identity未变化时自动选择新MacroRecord；dirty/JSON/edit-lease/pending/revision变化只创建和通知。所有Load路径均零Prepare。
* Load body不接收Room，不直接调用Prepare/Start；作为Macro create mutation仍必须使用server-verified.033 Room controller context。
* shared item mutation与.033 lease transition使用.032同一个canonical path-derived resource transaction guard；另一process后续read可见。
* q trim后empty返回kind全部items；非空对title/description/tags/content做case-insensitive substring，结果按updatedAt desc、itemId asc稳定排序，V0不分页。
* 旧Prompt/config/project/scope/source-record schema不迁移、不兼容。

Room lifecycle、controller/lease协议、Macro validator规则、terminal resolver、active run、cloud sync、cross-OS sync、rich editor、Library history、pagination、cross-process live push、automatic run和旧数据import均在范围外。

## 任务规范

### Library panel与client-local state

.032 browser-local layout current schema增加library panel key；不恢复server ui-layout。Macro与Library visibility入口使用同一个`.panel-toggle` switch presentation与`aria-pressed`状态，点击只改变对应browser-local visibility。Library header下固定三个tabs：

1. Macro JSON：kind为macro-template。
2. Prompt：kind为prompt。
3. Note：kind为note。

每个tab复用search、item list、metadata viewer/editor与actions。不存在scope selector；切换Room、selected Macro、terminal或Shell cwd都不改变Library list。selected kind/item/search属于当前browser，不广播，也不跟随selected Macro。

detail默认read-only。显式Edit先要求当前Room controller，再读取.033 safe lease view并携带expectedLeaseEpoch取得{kind:"library", itemKind:kind, itemId} lease；成功后才进入隔离draft。owner server基于该client的live Room WebSocket为active Edit session续期，browser不调用renew endpoint。foreign valid lease时仍可read/search/Copy/Load persisted content，但Edit和Remove显示content_edit_lease_held；foreign view只显示leaseEpoch/必要expiry，不得暴露editLeaseId、owner clientId或control grant。takeover确认同样冻结expectedLeaseEpoch，旧确认必须零mutation。

每个tab/editor至少维护selectedRecord、baseRecordRevision、draftContent/metadata、draftRevision、dirty、editLeaseId与operationGeneration。Save body同时携带editLeaseId和expectedRevision；record与lease state都成功后替换selected record、清dirty、消费server返回的retained grant推进base revision并保留当前Edit session。record atomic publish是.033 point-of-no-return：publish后lease-state refresh/release失败仍返回并广播authoritative saved/deleted结果与lost `leaseOutcome`；client安装server truth、清除旧lease、转read-only并明确提示，不能报告假失败或复活旧grant。clean session显示`Done`并由用户显式退出/release；dirty `Cancel`恢复last server record并release。Remove先确认，再取得或复用lease，Delete的record已publish后即使lease cleanup失败也按成功删除收口；point-of-no-return前的lease/revision变化仍零写入。

New创建没有itemId/base revision/edit lease的client-local空draft并进入编辑；首次Save由server生成fresh identity。create不为不存在的record取得lease，但仍要求.033 Room controller；create response提交后，client只可对fresh `(kind,itemId)`执行普通lease acquire，不得自动takeover。成功则继续Edit session；竞争失败时record已保存但editor转read-only并明确提示，同时进入独立的published-Create buffer preservation state。该state不是dirty或leaseLost的别名，必须阻止remote Save/Delete、background refresh与页面unload丢弃submitted buffer，直到用户显式解决。Save/Create pending时整个editor inert，统一draft mutation入口defensive guard；await后复核operationGeneration、selected key、base revision、draftRevision、controller epoch和editLeaseId，stale response不能覆盖新draft。

Refresh重新list，并在当前item未dirty、未editing、无edit lease/lease-lost/published-Create preservation状态且无pending时重新read。foreign update、Delete或lease takeover遇到dirty、editing、submitted-but-response-pending、published-Create preserved或lease-lost draft只显示准确notice，不覆盖或清空buffer；draft仍可Copy，但Save稳定失败直到重新取得lease并处理最新revision。preserved状态的普通`Cancel`必须改为明确的`Discard local copy`：点击后GET当前server record，存在则安装latest revision，404则清空selection；transport/其他读取失败必须保留本地buffer、preservation与unload guard。New/Select/Edit/Refresh也可按各自已有语义显式解决preservation，background refresh不得代替用户作决定。

Copy语义精确为：read-only时复制persisted content，Edit/New时复制当前draft content buffer；只调用navigator.clipboard.writeText。它不复制title、description、tags、itemId、revision、timestamps或record wrapper，不调用Library API、不validate、不创建item、不改变selection/dirty/revision。

clipboard Promise resolve后才可短暂显示Copied；reject时不得显示/保留Copied，显示stable clipboard_write_failed。成功或失败都不得改变Library/Macro count、selection、draft、dirty、revision或lease。不存在Duplicate/Import/Export按钮；相似item必须New → browser Paste → Save。

切换item/kind或New时，dirty draft必须Save、Cancel或显式确认discard；离开saved Edit还必须release lease。tab、selector和New属于同一个serialized navigation operation domain：在任何lease release await之前必须先递增operationGeneration并立即进入pending/inert，捕获kind、selected key、draft object identity、draftRevision与editLeaseId；每个continuation提交前逐项复核。pending期间再次切tab、选item或New必须明确返回operation_pending，Save pending期间也不得切换；stale continuation绝不能清除或替换更新的本地draft。关闭Library panel只改变browser-local布局可见性，不能unmount Library、确认discard、清除selection/draft/dirty/operation state或release lease；再次显示必须恢复同一页面内存状态。window focus或安全的background refresh仍可重新list/read及lease state，但不得覆盖dirty/editing/pending buffer；server不得把长期memory cache当文件真值。

Library selection与draft只存在于当前页面内存，不写入`localStorage`、`sessionStorage`或server。browser storage只保存panel visibility/width、selected tab和filter等UI偏好。Library有dirty draft或published-Create preserved buffer时必须与Macro dirty/JSON Edit/preserved buffer聚合到页面唯一native `beforeunload` guard：用户取消离开则Macro与Library内存状态都完整保留，确认离开才丢弃；真正clean且无preservation状态不得弹窗。V0不实现刷新后的Library draft恢复。

transient WebSocket reconnect不得把Library dirty聚合状态清零；App必须把新`connectionGeneration`传入常驻Library panel。新连接ready后Library重新list；clean readonly selection才允许read并安装不低于当前/summary revision的server truth，dirty、editing、active/lost lease或published-Create preserved buffer只更新changed/deleted notice。list与selected read使用各自单调generation，并在continuation复核connection、kind/query、selected identity/revision、draft object/draftRevision和完整protected state。transport/5xx返回`retry`，不得消费invalidation sequence；queue执行有界重试，并可由后续focus/reconnect继续drain。真正进入Home/unmount时才与Macro对称清除聚合dirty guard。

Macro JSON使用带1-based行号的等宽multiline editor，并提供Validate与Load into Macro。`Load into Macro`属于item级domain action，固定放在上方Library action toolbar；content editor下方的Macro专属action区只保留Validate，不能把Load埋在长JSON正文之后。Prompt/Note使用普通multiline editor，不显示Macro validation状态，也不解释JSON、双花括号或其他语法。workspace各side panel之间的横向resize hit area固定为6px透明区域，中央2px中性IDE式竖线仅在hover/focus/drag时增强；不得恢复宽实色分隔条。

### Current LibraryItem schema

唯一持久化record：

    type LibraryItemKind = macro-template | prompt | note

    type LibraryItem = {
      schemaVersion: 1
      itemId: string
      kind: LibraryItemKind
      revision: number
      title: string
      content: string
      description: string
      tags: string[]
      createdAt: string
      updatedAt: string
    }

record只允许exact keys。server通过.032 createGeneratedId(libraryItem)创建strict lib_ itemId，同时创建timestamps和revision 1；create request不得接收caller-supplied itemId。update递增revision；itemId、kind和createdAt创建后不可修改。record不得包含scope、projectId、serverInstanceId、roomId、configId、cwd或terminal identity。

title trim后非空；description为string；tags trim、去空、去重；timestamps为ISO string。Prompt/Note content可为空且不做语义解释。Macro JSON content trim后非空，并必须解析为.034 exact MacroDefinitionV3。

canonical identity精确为(kind,itemId)。相同itemId出现在不同kind时属于不同record；同一kind内不得重复。list summary返回itemId/kind/revision/title/tags/updatedAt，detail返回完整record。route/path中的kind必须与record.kind一致。非法persisted ID或path/body kind mismatch按current schema fail loudly。

### Search contract

`GET /api/library/items`的kind required，q optional。server先对q执行trim；缺失或trim后empty时返回该kind全部items。非空query对每个record的title、description、每个tag及content执行Unicode string的case-insensitive substring匹配；V0统一使用同一server helper进行lowercase normalization，client不得再二次过滤或只搜title。

结果始终按updatedAt降序排列；timestamp相同按itemId code-point升序。V0返回全部matching summaries，不分页，不接受cursor/limit/offset/sort字段。Refresh、focus与下一次相同query必须遵循同一排序，不能受filesystem enumeration order影响。

### Frozen storage与cross-process mutation

本任务只调用.032 path/shared-store helpers：

    <user-root>/library/<kind>/<itemId>.json

不得读取terminal cwd下.shell-deck、旧Prompt path、Project bucket、profile root或独立Global data root。

create/update/delete采用.032唯一canonical per-resource transaction guard、same-filesystem temporary file、fsync/atomic replace与optimistic revision。server生成itemId后从规范化`library/<kind>/<itemId>.json`派生guard，在guard内确认目标不存在并create；碰撞时释放guard、重新调用统一factory。update/delete与该record的lease acquire/owner-server renew/release/takeover必须取得同一个guard，并在guard内依次复核.033 Room controller、canonical resource editLeaseId与current revision后commit；不得另建directory reservation lock、store lock或lease lock。stale返回content_revision_conflict，lost lease返回.033稳定错误。失败时保持现有record可读，不报告silent success。

不同process不得用单process mutex、memory cache或last-write-wins绕过revision/lease。.033 content lease state位于`.locks/content-edit`但不是第二把resource lock；transaction guard只在lease transition或record commit期间短暂持有，不得在整个Edit会话持有OS lock。mutation完成后，任一使用相同User Data Root的process下一次list/read必须返回新record。cross-process WebSocket live invalidation不在范围；发起mutation的process仍广播给自己的全部connected clients，不按Room过滤。

### HTTP与WebSocket

Library routes：

    GET    /api/library/items?kind=<kind>&q=<text>
    POST   /api/library/items
    GET    /api/library/items/:kind/:itemId
    PUT    /api/library/items/:kind/:itemId
    DELETE /api/library/items/:kind/:itemId
    POST   /api/templates/from-library

list的kind required、q optional且逐字遵守Search contract。create body exact为{kind,title,content,description,tags}，不带existing-record lease；update body exact为{title,content,description,tags,expectedRevision,editLeaseId}；delete使用exact If-Match revision与X-Shell-Deck-Content-Edit-Lease。create/update/delete及Load-created Macro都必须携带.033 Room controller context/headers；body不得携带scope、roomId、terminal、cwd、record id或server identity。

path/load itemId必须通过.032 assertGeneratedId(libraryItem)。unsafe ID、path/body kind mismatch、unknown field、missing record和invalid revision明确失败。旧Directory/Global nested routes与move route未注册。/duplicate、/clone、/copy、/import、/export或其他copy-and-create mutation route同样未注册；Copy是纯client clipboard operation，Paste使用browser能力。

WebSocket复用`.035`唯一generic `content_record_changed`：Library resource key精确为`{kind:"library", itemKind, itemId}`，并携带`saved/deleted` operation与revision。mutation process向自己的全部connected clients广播user-content invalidation，不按Room过滤；不得新增第二套Library专用消息。事件identity也是(kind,itemId)，consumer不得只以itemId合并不同kind。另一process通过Refresh或下一次read看到内容。广播以record publish为准，不以lease maintenance为准：Update/Delete response与broadcast必须反映同一个authoritative revision或deleted truth；`leaseOutcome: lost`只改变当前editor能否继续写，不撤销、隐藏或延迟已经发布的content mutation。

Library consumer必须继承`.035`的observed/handled分离语义：local operation pending期间按sequence缓存所有Library invalidation，不能在handler入口return后仍推进handled watermark；operation settle后按(kind,itemId)、operation、revision顺序replay。当前revision相同或更旧的`saved`是ack/stale event；更高revision与`deleted`必须覆盖旧Save response留下的status/notice，但不得覆盖本地submitted/dirty/lease-lost/published-Create preserved buffer。list refresh发现record消失时同样必须遵守该preservation规则，不能先清selection再处理Delete event。

consumer的list/read结果必须分类为`applied | stale | retry`；只有`applied`可推进对应batch watermark。旧generation、旧connection、低于目标revision或state identity已变化的response一律`stale`且零安装；500/transport error为`retry`并保留event。一次失败不得让saved-content truth永久停在旧revision。

### 消费.034唯一Macro definition validation gateway

`src/lib/macro/macroDefinitionValidation.ts`、`parseAndValidateMacroDefinitionJson`及MacroDefinitionV3 issue-code contract由.034拥有并完成所有既有caller迁移。.036只新增Library text caller：

* Macro JSON Validate：把当前editor buffer原文直接传给`parseAndValidateMacroDefinitionJson`；invalid_json显示gateway给出的zero-based UTF-16 offset与1-based line/column/message，invalid_macro_definition显示原顺序stable issues，ok=true才显示valid。
* Macro JSON Save：server把request content原文直接传给同一文本入口；invalid_json或invalid_macro_definition都逐字返回、零write并保留draft，ok=true才保存原始content string。server不信任browser Validate结果。
* Load：把source persisted content原文直接传给同一文本入口；只有ok=true才把result.value交给Macro store create，invalid_json/invalid_macro_definition都零Macro write。

.036不得在任何browser/server path直接JSON.parse Macro content、解析native parser message、计算自己的offset/line/column、创建issue code，或修改gateway schema/token/capability/runtime规则；不新增policy vocabulary，不直接import private rule engine，也不把validator ownership写回本task。Prompt/Note永远不调用gateway。portable validation不读取Room、terminal readiness或MacroRecord metadata；runtime binding仍只属于.034 Prepare/Start。

### Macro JSON content

Macro JSON tab保存以下纯definition：

    {
      "schemaVersion": 3,
      "name": "Two terminals",
      "description": "",
      "terminalLayout": [
        { "index": 1, "type": "shell" },
        { "index": 2, "type": "text" }
      ],
      "body": []
    }

content不得包含MacroRecord的id、revision、createdAt、updatedAt或definition wrapper，也不得包含Room、cwd、terminalId、launchId、alias、server URL或terminal mapping。Library title只是素材标签，不覆盖definition name。除current MacroDefinitionV3已支持的template语法外，不新增placeholder、alias或兼容token。

Validate只返回`parseAndValidateMacroDefinitionJson` exact result，不写Library/Macro/Room。Save Macro item必须在server重新调用该文本入口；非法时保留draft并拒绝write。server不信任client validation，也不得重新排序、去重、翻译或改写.034 parse result/issues。

### Save current Macro to Library

Macro template toolbar提供唯一文字按钮`Save to Library`。它读取当前页面内存中的visual Macro draft；draft可以是未保存New、dirty Edit或read-only saved definition，不要求先创建/更新MacroRecord。JSON Edit开启、Macro lock-sensitive operation pending、无draft、无Room controller或portable definition非法时拒绝，且零Library write。

合法请求调用现有Library Create创建fresh `macro-template` item：`title = definition.name`、`description = definition.description`、`tags = []`、`content = JSON.stringify(validatedDefinition, null, 2)`。server仍按Library Macro Save规则重新走唯一`parseAndValidateMacroDefinitionJson`，生成fresh `lib_` identity/revision/timestamps并广播generic content invalidation；重复点击得到独立LibraryItem，不更新或猜测同名item。

成功只把按钮短暂显示为`Saved`。当前Macro的selectedRecord、base revision、draft、dirty、content edit lease、view、terminal layout/runtime validation与runner状态全部不变；不隐式Save Macro、不打开/切换Library panel、不选择新Library item、不Prepare/Start。该动作与clipboard `Copy`、Duplicate/clone及Library内相似item创建无关，是明确的跨domain materialization。

### Load into Macro

Load request：

    POST /api/templates/from-library

    {
      itemId: string
      expectedRevision: number
    }

source kind固定为macro-template，因此canonical source key为(macro-template,itemId)，body不重复传kind或scope。server：

1. 按.033验证caller当前Room controller；body roomId不被接受，Room identity来自server-verified request context。
2. 校验strict lib_ itemId，从<user-root>/library/macro-template/<itemId>.json重读exact persisted record并校验revision。source即使被foreign edit lease占用也可读取该saved revision。
3. 把content原文交给.034 `parseAndValidateMacroDefinitionJson`；invalid_json或invalid_macro_definition均立即失败且零Macro write。
4. 只把ok=true返回的MacroDefinitionV3 value原样交给.034 production user-global Macro store create。
5. Macro store生成fresh strict tmpl_ id、revision 1、createdAt/updatedAt，并以exclusive create/collision retry写入MacroRecord；fresh record不需要existing macro edit lease。
6. 广播template update并返回完整新MacroRecord。

Library item/content及其lease不改写；重复Load得到definition相同、record id不同的MacroRecord。Load route不接受caller-supplied templateId、record metadata、body roomId、terminal mapping、cwd或autoPrepare flag，不读取live terminal，不调用.034 Prepare/Start。

client发请求前捕获Macro editor guard：

    {
      selectedRecordId,
      baseRecordRevision,
      draftRevision,
      dirty,
      jsonEditing,
      editLeaseId,
      operationGeneration
    }

response后只有请求前后都满足dirty=false、jsonEditing=false、editLeaseId=null、无其他lock-sensitive pending，且selectedRecordId、baseRecordRevision、draftRevision、operationGeneration逐项未变化，才自动切换到新MacroRecord。selectedRecord=null在其余条件满足时属于clean。任一条件不满足都保持selection/draft并显示“已创建、未自动切换”。

自动切换只是client-local Macro selection并触发.034只读layout validation，绝不调用Prepare。创建成功不因client state变化或切换失败而回滚；terminal mismatch只标红并禁用Start。用户后续可在Macro面板以当前draft layout显式点击`Prepare terminals`，这不是Load operation的phase，也不由Library观察结果。Library不得读取或恢复Trace/RunManifest中的terminal snapshot。

### Legacy Kill List

实现完成时必须删除或不可达：

* old Prompt component/store/client/routes/message/files。
* scope field、Directory/Global/All filter、scope move、project/profile/config-bound record。
* Library own data-root/env resolver、terminal cwd write或第二套user root。
* Library Macro content中的完整MacroRecord、definition wrapper、source tmpl_、revision或timestamps。
* configId/projectId/roomId/serverInstanceId/cwd/terminal identity in Library record或Macro definition。
* Library terminal mapping、Load route直接Prepare/Start和Library/Macro live link。
* .036重新定义/复制Macro validator、caller-local validation、gateway bypass、migration/alias/dual read/Convert/fallback。
* Library browser/server direct JSON.parse Macro content、native parser message解析、自行position计算或caller-created issue code。
* Library内的Duplicate/clone/Import/Export/同kind copy-and-create route、button、client/store method，或clipboard Copy触发server mutation/record create。Macro toolbar明确命名的`Save to Library`是本task唯一跨domain create，不属于此禁项。
* Copy携带title/tags/record wrapper、clipboard失败仍显示Copied，或把Load into Macro伪装成Library Duplicate。
* 把itemId单独当全Library canonical key或跨kind collision domain。
* saved item默认可写、只靠client readonly、update/delete缺少editLeaseId或用单process mutex替代.033 lease。
* client-only search、title-only search、filesystem-order结果、不稳定sort或V0 pagination参数。
* Library/Macro业务模块direct short-uuid import、宽松lib_/tmpl_ positive fixture或caller-suppliedgenerated identity。

## 示例

### 三类user content与Copy

用户在Prompt tab保存任意提示词，在Note tab保存invalid JSON和双花括号笔记；两者都按普通text接受。read-only Copy复制persisted content，Edit中的Copy复制draft buffer；Library item数量、revision、dirty和selection不变。clipboard拒绝时显示clipboard_write_failed而非Copied。用户要创建相似item时显式New、browser Paste、Save；不存在Duplicate/Import/Export。

### Edit lease与search

Room A取得(prompt, lib_A)的Edit lease后，Room B和另一个server process仍可搜索、读取和Copy该item，但Edit/Remove只读；它们可以同时编辑(note, lib_B)。Room A Save时lease与expected revision都通过才提交，成功后仍持有更新过base revision的同一Edit session，直到Done/Cancel/切换/卸载。

Prompt query `  SIGNAL  ` trim/lowercase后匹配title、description、tags或content中的signal。empty query返回全部Prompt；结果总按updatedAt降序、itemId升序，与文件枚举顺序无关。

### identity

(macro-template, lib_A)与(prompt, lib_A)是两个不同record；同一kind内第二个lib_A create必须collision retry。API、filesystem path、client map key和WebSocket event都携带kind。

### Load

Library Macro content是纯MacroDefinitionV3，不含tmpl_、revision、timestamps、Room、cwd或physical terminal identity。Load后.034 Macro store生成fresh MacroRecord。Macro editor guard请求前后都clean且未变化时自动选中；dirty、JSON Edit、edit lease或pending editor只创建、不切换。两种结果都不Prepare。重复Load生成两个独立MacroRecord，source item不变。

### Save to Library

用户New一个未保存Macro或在Edit中留下dirty draft，只要portable definition合法即可点击`Save to Library`。Library得到fresh Macro JSON item，而Macro仍保持原selection与dirty状态；Library panel不会被强制打开。非法definition、JSON Edit和observer点击均明确失败且零item create。

### 失败反例

* Macro content是V2、完整MacroRecord或包含roomId/TerminalTarget/cwd：schema issue，不转换。
* Library record包含scope或projectId：unknown-field error。
* Library itemId是lib_test或Load body自带templateId：identity/unknown-field error。
* GET /api/library/global/items、move、duplicate、clone、import、export或copy mutation route：not found。
* 点击Copy后新增Library item、复制metadata或clipboard reject仍显示Copied：contract violation。
* stale revision update/delete/load：content_revision_conflict；lost/foreign edit lease按.033 fail loudly。
* Load body携带roomId/terminalMapping：unknown-field error。
* Prompt/Note含invalid JSON或旧template token：普通文本合法。

## 测试规范

### Unit / store

* Library exact schema、三个kind、无scope、revision、metadata与strict lib_ factory/validator。
* canonical (kind,itemId)、cross-kind same ID合法、same-kind collision retry和caller-supplied ID反例。
* .032 frozen root、single Library path、terminal cwd零写入。
* search q trim/empty、title/description/tags/content case-insensitive substring、updatedAt desc/itemId asc stable order与无pagination。
* list/read/create/update/delete、controller/editLeaseId/expected revision、stale conflict与invalid-file fail-loudly。
* two-process read-after-write、same-record edit lease exclusion、different-record parallel edit、concurrent update single winner、no permanent cache，以及barrier强制lease takeover与record update交错时同一transaction guard只产生合法先后序。
* Prompt/Note arbitrary content；MacroDefinitionV3、V2/record wrapper/terminalLayout/capability/token validation。
* .036只调用.034 public text gateway；invalid_json UTF-16 offset/line/column与invalid_macro_definition分层，ok=false issues顺序/内容不变，且无direct JSON.parse、native-message parser、private-validator/direct rule copy。

### HTTP / integration

* generic CRUD routes、required kind、path/revision/lease/controller exact validation与traversal-safe paths；无public browser renew，duplicate/clone/import/export/copy mutation routes不存在。
* generic content_record_changed按(kind,itemId)消费；不新增Library专用消息，也不伪造cross-process push。
* Load fresh MacroRecord identity/revision/timestamps、definition preservation、source immutability、repeat independence和failure zero-write。
* Load body无Room/terminal/cwd mapping、request context验证.033 controller且不直接调用.034 resolver。
* clean guard逐项相等才auto-select；dirty/JSON/edit-lease/pending/state-changed只通知；两条路径都断言零Prepare request。
* oldPrompt/config/project/scope/global/move/source-record routes/files不可用。

### Browser E2E

* Library panel三tabs、无scope selector；browser-local selected tab/search保留；人为延迟lease DELETE时tab/selector/New严格串行，旧navigation continuation不能清除较新的draft，Save pending切tab稳定返回operation_pending。
* Library继续占用既有Prompt panel的位置、宽度/visibility/reset-width职责并沿用workspace控件视觉语言；.034 Macro/terminal DOM层次与主要控件顺序不因Library实现而改变。
* 验证Library header/status、tabs、search/list、actions、editor和notice/error/dirty层次，以及keyboard focus、pending inert和窄宽度toolbar/editor响应；不使用截图或pixel差异作为Gate。
* 切换Room、Macro或terminal cwd不改变Library items；另一process Refresh可见。
* CRUD/stable search、saved read-only、Edit lease、New/browser Paste/Save、dirty navigation、revision/lease conflict、remote notice和Remove confirm；确定性延迟A Save/Create response，覆盖自身revision ack不误报、B takeover后Save更高revision与Delete均在A settle后replay且保留A submitted buffer。首次Create竞态还必须验证`beforeunload`生效，`Discard local copy`在remote Save后安装latest、remote Delete后清selection，并在resolution后解除guard。
* fault injection覆盖Library Update/Delete的record已publish、lease-state refresh/delete失败：HTTP仍返回authoritative success + lost leaseOutcome，所有本process clients收到saved/deleted invalidation，GET/List与文件真值一致，旧lease不能再次commit。
* Copy零API request、零item create、零metadata copy、零selection/dirty/revision/lease变化；resolve才显示Copied，reject显示clipboard_write_failed；UI无Duplicate/Import/Export。
* Macro JSON line numbers/Validate/Save guard；Prompt/Note不解释相同文本。
* Macro JSON不要求或显示record id/revision/timestamps。
* 同record跨Room/process只有一个editor，foreign observer仍可search/read/Copy/Load persisted revision；不同record可并行。
* clean unchanged Load auto-select；dirty/JSON/edit lease/pending/state-changed只创建；两者都零Prepare，用户显式按钮操作属于后续独立交互。
* Library dirty draft在panel隐藏/显示后完整保留且不出现discard dialog；dirty或published-Create preserved状态触发页面统一native unload确认，正常Save/Cancel或显式preservation resolution后解除。browser storage中不得出现title/content/draft/JSON业务正文。

### Gate与残留扫描

* 新增just test-036，并保留test-032/033/034/035历史入口。
* 运行just check、just build、just test-036、just test-031b、browser Gate和git diff --check。
* rg扫描Prompt residue、scope/Directory/Global Library、move/duplicate/clone/import/export/copy mutation route、Duplicate/Import/Export UI/client/store、Library root resolver、source tmpl_/record wrapper、validator ownership/gateway bypass、Library direct JSON.parse/native parser message/position计算、Load直连Prepare、itemId-only key、client-only search、lease bypass、direct short-uuid import与宽松ID fixture。
