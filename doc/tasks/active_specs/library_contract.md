# User Content Library Contract

## Scope 与 identity

Library是同一User Data Root下唯一的user-global长期素材集合，不属于Room、server process、terminal cwd或当前Macro selection。它固定包含`macro-template`、`prompt`、`note`三个kind；不存在Directory/Global scope、Project/config binding、migration或旧Prompt兼容入口。

唯一record为exact `LibraryItemV1`：`schemaVersion/itemId/kind/revision/title/content/description/tags/createdAt/updatedAt`。server使用统一generated-ID module生成strict `lib_` id、revision和timestamps；canonical identity是`(kind,itemId)`，path为`library/<kind>/<itemId>.json`。title trim后非空，tags trim/去空/去重；record metadata不可由client指定或修改。

## Store、search 与同步

Create/Update/Delete使用`.032`由canonical record path派生的cross-process transaction guard、private atomic file和optimistic revision。saved Update/Delete还必须在同一guard内通过`.033`的Room controller与`{kind:"library",itemKind,itemId}` content edit lease。owner server根据live WebSocket续期；browser不拥有renew authority。record atomic publish是point-of-no-return：之后lease-state维护失败仍返回authoritative success与lost leaseOutcome，client清除旧lease并转read-only，不能把durable mutation伪装成失败。

List要求kind。query trim后为空返回该kind全部item；否则对title、description、tags和content进行case-insensitive substring匹配。结果固定按updatedAt降序、itemId升序，不分页，也不做第二份client filter。

成功mutation复用generic `content_record_changed`向当前process全部连接广播`{kind:"library",itemKind,itemId}`；广播以record publish为准，即使leaseOutcome lost也必须发送saved/deleted authoritative truth。browser将local operation pending期间的事件按sequence排队，settle后才按identity/revision replay并推进消费状态。相同或更旧revision是ack/stale event；更高revision与Delete必须更新saved-truth notice，但不得覆盖或清除submitted/dirty/editing/lease-lost/published-Create preserved draft。不同server process不伪装live push，下一次List/Read/Refresh直接读取共享文件真值。

list/read outcome统一为`applied | stale | retry`；只有`applied`消费batch。旧generation/connection、低revision或identity/state不匹配的continuation零安装，5xx/transport失败保留event并做有界重试。

## Panel lifecycle 与 Copy

Library side panel继承workspace既有panel位置、width/visibility/reset-width和控件视觉语言。Macro与Library顶栏入口统一为带track/thumb和`aria-pressed`的switch button；side panel resize使用6px透明hit area与中央2px中性IDE竖线，不显示宽实色分隔条。三个kind共用Search、selector、New、Edit、Save、Cancel、Copy、Remove、Refresh；Macro JSON的`Load into Macro`同样位于上方item action toolbar，正文下方只保留Validate。saved detail默认read-only。panel组件保持常驻，visibility只改变布局显示，隐藏/显示不得清空selection、draft、dirty或lease。selected item与draft不跨browser同步且只存在于页面内存；tab/filter以及panel visibility/width属于strict browser localStorage UI setting，业务title/content/draft不得进入browser storage。

Library workbench不拥有component `<style>`或global legacy selector；existing DOM与control顺序直接使用daisyUI semantic class和static Tailwind utility，并保持1600/900/720的panel、scroll owner与compact density。browser Theme与Library tab/filter同属local presentation/settings层，但Theme不进入LibraryItem、search、draft、lease或server request；readonly、pending、dirty、invalid与disabled state在全部theme中必须继续可区分。

New创建无identity的client-local draft。Edit取得per-record lease后建立隔离draft；pending时editor readonly/inert。Save成功安装新revision、清dirty并保留当前Edit session/lease，clean session用Done退出；普通Cancel恢复最后saved snapshot并best-effort release。New首次Create后必须为fresh identity取得lease才继续编辑；竞争失败保留submitted buffer、转read-only并进入独立preservation state。此时按钮显示`Discard local copy`，点击后必须GET server truth：存在则安装latest revision，404则清selection，其他失败保持local copy与guard。Remove确认后取得/复用lease。远端saved revision、Delete或lease takeover只提示，不覆盖本地submitted/dirty/preserved buffer；list/background refresh也必须遵守同一preservation规则。

Library dirty或published-Create preserved local copy与Macro dirty/JSON Edit/preserved local copy由页面聚合到唯一native `beforeunload` guard。取消离开保持当前页面内存状态，确认离开才丢弃；显式resolution后的真正clean状态不提示，V0不从`localStorage`、`sessionStorage`或server恢复未保存draft。

transient WebSocket reconnect不清Library dirty/preserved page-memory guard；显式`connectionGeneration`触发重新list。只有clean readonly selection可安装revision单调不退后的server truth，dirty/editing/active-or-lost lease/preserved buffer只更新notice。list/read continuation分别校验generation、connection、kind/query、record identity/revision、draft identity/revision和完整protected state；500/transport失败不得消费`content_record_changed`，queue有界重试并在focus/reconnect继续drain。进入Home/unmount才与Macro对称清理聚合dirty状态。

实现上，`createLibrarySession`继续是kind/search/selection/draft/lease及全部Svelte rune state的唯一owner和唯一public assembly point，既有`LibraryNavigationCoordinator`继续唯一冻结operation/controller/kind/selection/draft/revision/lease identity。Library-specific `LibraryMutationWorkflow`只编排Library client、fresh lease、persist/delete/release transaction并返回显式outcome；`LibraryRemoteSyncCoordinator`只持有invalidation queue、retry timer、read/connection generation与serialized drain，通过live snapshot/commit ports让factory应用结果。两者不缓存第二份item/draft/lease state，也不与Macro共享generic content session。

Copy在read-only时复制persisted content，在New/Edit时复制当前draft content，只调用`navigator.clipboard.writeText`。resolve后才短暂显示Copied；reject显示`clipboard_write_failed`。Copy不携带metadata、不调用server、不改变revision/selection/dirty/lease，也不存在Duplicate、clone、Import、Export或copy-and-create。

## Macro JSON 与 Load

Prompt和Note始终是任意text。Macro JSON content只能是纯`MacroDefinitionV5`，不含MacroRecord envelope、Room/cwd或physical terminal identity。Validate、server Save和Load都把原始text交给`parseAndValidateMacroDefinitionJson`，保持`invalid_json` position与`invalid_macro_definition` issues分层；Library不拥有第二套parser或validator。exact`{kind:"unassigned"}` terminal/required-artifact slot属于合法的persistable Macro素材，Save与Load必须原样保留；Validate同时调用runnable completeness并把它显示为`valid · N unassigned references (not runnable)`，不能把它误报成invalid。

Library `macro-template` list与MacroRecord list采用同一invalid saved-content isolation语义：invalid LibraryItem envelope或无法通过唯一V5 text gateway的content不进入selector，list response返回stable `itemId/error` diagnostic，UI明确显示ignored item；直接read invalid Macro Library item fail loudly。该隔离不是compatibility或migration，server不会读取、转换或自动补旧schema。Prompt/Note不经过Macro validation。

`POST /api/templates/from-library`重读exact `(macro-template,itemId,expectedRevision)` saved source，经唯一validator后由production Macro store创建fresh `tmpl_` MacroRecord。source不改写，重复Load得到独立record。Macro editor的NavigationCoordinator只执行create/list request phase；factory在response后再次比较selected record/revision、draft revision、dirty、JSON edit、edit lease、operation generation/pending与controller epoch。request/response两端都clean且identity未变化时才自动选择新record；否则只创建并提示，不切换。Load永远不读取terminal、不Prepare、不Start。

Macro toolbar的`Save to Library`执行反向的显式domain action：当前visual draft只要persistable-valid即可创建fresh `macro-template` LibraryItem，不要求先Save MacroRecord。item的title/description取definition、tags为空、content为canonical pretty JSON；server仍通过唯一text validator。成功不保存或切换Macro、不清dirty、不打开/切换Library、不Prepare/Start。JSON Edit/pending、observer、无draft或invalid definition均零write。它不是clipboard Copy、Duplicate或同kind copy-and-create。

## Persistence 与 runtime boundary

Library item持久化；panel selection、draft、operation state和clipboard状态不持久化。Library与Room runner正交：saved record可跨Room/process读取，live Room、terminal与runner仍只存在当前server process。current schema不读取或转换旧Prompt、scope、完整MacroRecord Library item或任何alias。
