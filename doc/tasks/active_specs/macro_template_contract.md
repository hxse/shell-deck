# Macro V5 Contract

## Definition、Record 与 exact references

唯一current格式是`MacroDefinitionV5`：`schemaVersion`必须精确为`5`，并包含`name`、`description`、`terminalLayout`与`body`。`terminalLayout`只保存从1开始连续的terminal `index/type`；definition不保存record metadata、Room/server identity、cwd、terminalId、launchId、alias或旧configId。

持久化envelope是`MacroRecord`：server生成`tmpl_` id、revision、createdAt、updatedAt，并把definition放在`definition`字段中。JSON editor与clipboard Copy只处理definition，不处理record envelope。

运行所需terminal slot使用exact union：

```ts
type MacroTerminalReference =
  | { kind: "terminal_index"; index: number }
  | { kind: "unassigned" }
```

该字段名固定为`terminal`，用于root Send/Input/terminal-quiet Wait、Capture config与Parallel lane。lane内Action继承lane terminal。artifact source按value family分为text与JSON；Message、Input default、Extract及`text_match`是正式textual consumer，可读取`captured_text | merged_text | extracted_text | captured_json`。text value逐字读取；JSON在read boundary递归按Unicode code point排序object key，并投影成无缩进、无末尾换行的canonical JSON，不双写字符串artifact。`json_match`只读取`captured_json`并保持typed比较。Parallel Output仍只读取lane-local text artifact。required source允许exact `{kind:"unassigned"}`；`Input.defaultSource`仍是optional assigned-only，Parallel Output的`{kind:"none"}`仍表示明确不输出。

AgentEvent与structured JSON Capture共享exact wait policy：

```ts
type CaptureWaitLimit =
  | { kind: "unbounded" }
  | { kind: "timeout"; timeoutMs: number }
```

新建这两种Capture默认unbounded。timeout branch要求positive integer毫秒，只计算active waiting time并在到期时fail；其他Capture kind不得携带`waitLimit`。root Flow另支持：

```ts
{
  kind: "structured-json"
  terminal: MacroTerminalReference
  schema: JsonSchema
  waitLimit: CaptureWaitLimit
}
```

`schema`按JSON Schema 2020-12独立编译；真正schema object位置上的`$ref`/`$dynamicRef`只接受以`#`开头的local fragment且不联网解析remote resource，检查只沿标准subschema keyword下钻，不能把`properties`/`$defs` map key或`const`/`enum`/`examples` instance data误当reference keyword。schema `$id`不能形成跨Macro registry或令同一saved schema重复validation失败。invalid schema以`invalid_json_schema`失败。structured Capture只产生`captured_json`；它不允许出现在Parallel lane，也不双写`captured_text`。

App Notify channel的唯一current shape是`{kind:"app", toast:boolean, sound:NotificationSound, repeatCount:number, repeatIntervalMs:number}`。`repeatCount`表示包含首次呈现的总次数，必须是1到10的integer；`repeatIntervalMs`表示相邻呈现的间隔，必须是250到60000的integer。新建App channel默认3次、1000ms；两个字段始终required，缺失、fraction、越界或额外旧字段均fail loudly，不补默认、不迁移。

这是current-schema-only hard cut。V4及更早definition、primitive `terminalIndex` persisted field、physical target、空stepId placeholder、missing artifact source、missing waitLimit、alias、migration、adapter、dual validator与自动转换均不存在；旧输入必须fail loudly。

## 三层 Validation

`src/lib/macro/macroDefinitionValidation.ts`是唯一validation gateway：

1. `validateMacroDefinitionV5(input)`与`parseAndValidateMacroDefinitionJson(text)`检查可持久化的exact schema、Flow语义、assigned terminal layout/capability、assigned earlier artifact、template与regex。白名单slot中的exact`{kind:"unassigned"}`合法，不产生persistable issue。
2. `validateRunnableMacroDefinitionV5(input)`在persistable基础上为每个未指派slot返回stable `unassigned_terminal_reference`或`unassigned_artifact_reference` path。它不读取Room、不改写definition。
3. live runtime validator只接收runnable definition，再检查当前Room的index/type、terminalId/launchId binding与readiness。

assigned但missing/future/wrong artifact或assigned terminal缺layout/capability mismatch仍是invalid definition，不能自动降级为unassigned。Macro/JSON Save使用第1层；Start严格按persistable→runnable→live Room执行。server Start对not-runnable返回`macro_not_runnable`及issues，零run安装、零terminal mutation、零`run_started`。

`parseAndValidateMacroTerminalLayoutFromDefinitionJson(text)`只供显式Prepare从当前JSON buffer读取layout；它没有last-valid fallback，也不让无关body错误阻止layout Prepare。

Visual deep-rune draft是已建立V5 tree shape的trusted live state。它使用clone-free diagnostics入口在一次node traversal内同时得到persistable与runnable结果，并保持上述issue code/path/order以及“persistable失败时runnable复用基础issues”语义；JSON parse、record persistence与Start frozen snapshot等trust boundary仍做strict validation/clone。同一`draftRevision`的render与hard action共享diagnostics。普通输入后的diagnostics可在40ms trailing窗口合并，但Save、Prepare、Start、切换JSON等正式读取边界必须同步flush，字段值/caret/draft mutation本身不debounce。

## Visual authoring

Visual editor不展示独立Terminal layout section。eligible terminal/artifact selector第一项始终是可选择的`Unassigned`。凡selector允许Unassigned，新建Action、切换出一个新引用slot、添加If/Elif或Parallel lane时一律默认写入exact `{kind:"unassigned"}`，即使当前已有compatible terminal或earlier compatible artifact也不自动代选。用户只有显式选择才形成assigned reference，也可以从assigned显式切回Unassigned；实现不猜测terminal 1、不自动选择earlier/future/sibling producer、不创建资源，也不隐式Prepare。

unassigned使用amber局部warning并明确“Save is allowed, Start requires assignment”；它不是red persistable error。Macro总体portable Validation可为success，而Start通过runnable completeness单独禁用并显示未指派数量。

用户选择assigned terminal时，同一次draft mutation从既有layout尾部到所选index复制连续`index/type` prefix，再更新reference；每次visual mutation递归扫描assigned terminal references，并裁掉最高引用后的unused layout tail。unassigned不贡献layout。New/delete/reorder/readiness等terminal event只刷新候选和runtime validation，绝不改写draft；terminal创建后仍要求用户显式选择。

结构Add/Move只受body/branch/lane结构规则约束。If/Elif/Extract没有earlier artifact时仍必须插入，并以unassigned source成为可保存但不可运行的draft。结构变更令既有assigned source失效时保留错误引用并显示persistable issue，直到用户修复或显式改为Unassigned。

For text-list不提供header级`Add item`；每个item以icon-only `Insert item above`/`Insert item below`在当前index或`index + 1`插入exact empty item，并继续保留Move/Remove。in-scope scalar Title/Prompt与Message text part启用`Use loop template`后只显示紧凑的exact `{{index}}`、`{{key}}`、`{{value}}`插入按钮，不显示`Available...from...`source提示。

Parallel schema、validator与runner不因authoring简化而变化，每条lane仍有且仅有一个final Output。UI以`Collect lane text`映射现有`output.source`：unchecked写入`{kind:"none"}`并隐藏id/source；checked只在存在earlier lane-local Capture/Extract时选择最靠后的artifact，否则保持unchecked并提示。只有任一lane收集text时显示merge separator与include-empty controls，`onLaneFail`始终可见。

JSON editor保持纯文本语义，不读取Room、不补引用或wait policy。JSON Save使用V5 persistable gateway；合法unassigned与exact waitLimit必须原样round-trip。

root Capture editor按所选Shell capability提供`structured-json`，保存raw JSON Schema与waitLimit；JSON parse失败或parse-valid但compile-invalid的schema编辑文本都作为逐字invalid draft保留并阻止Save，不能pretty-print或回退到上一个合法schema。Schema editor沿用普通multiline字段的默认自适应高度，不单独放大。合法Schema可打开theme-native建议提示词modal；提示词包含当前Schema、`just -f "$SHELL_DECK_JUSTFILE" submit-json` stdin命令、成功条件和schema mismatch重试说明，只供复制或手动选择，不自动改写任意Send。完整提示词由上下相同的`------------`包裹，分隔线与正文之间保留空行，区块前后各保留换行。clipboard失败时正文保持可见并提示手动复制，invalid Schema时入口disabled。If editor显式切换`text_match/json_match`：text matcher列出全部earlier artifact并按统一textual projection读取；JSON source只列earlier `captured_json`，使用JSON Pointer与typed scalar/number matcher。root/Parallel Send、Notify message、Input default与Extract Text同样列出earlier `captured_json`；Parallel capture palette仍过滤structured kind，final Output仍只列lane-local text。

## CRUD 与 editor lifecycle

production surface只提供list/create/read/update/delete。Create/Update/Delete必须通过Room controller；既有record的Edit/Update/Delete还必须持有per-record content edit lease并匹配expected revision。Delete可从read-only selected record直接发起，但操作内部仍须acquire/takeover lease、重读current record并按expected revision删除。

List逐record扫描并只为current V5生成summary。V4及更早definition、invalid envelope或损坏JSON不读取、不迁移，只作为`invalidRecords` id/error诊断返回；它们不得令其他valid record从selector消失。Macro UI持续显示该诊断，显式Read invalid record仍fail loudly。清理旧文件采用明确删除，不提供legacy reader、migration或自动转换。

New是browser-local draft，新Room默认不选Macro；New/editing期间selector与New保持可用，dirty切换走discard确认。selector首个`Select macro`空值option是可选的显式null selection：clean时清除selected/base/draft并回到`No macro selected`，dirty时遵守同一discard确认且拒绝时恢复native value；它不Delete/Save/Prepare或影响active run。New首次Create后必须按fresh record identity取得lease才继续编辑；竞争失败时保留submitted buffer、转read-only并进入独立published-Create preservation state，直到显式New/Select/Edit latest解决。selection、visual/JSON draft、dirty与editor tab不跨browser同步。成功Create/Save/Delete后的record是user-global saved state；generic `content_record_changed`在local operation pending期间按sequence排队，settle后才按record/revision replay并推进消费状态。相同或更旧revision是ack/stale event；更高revision与Delete必须更新saved-truth提示，但不得切换其他browser selector或覆盖submitted/dirty/editing/lease-lost/published-Create preserved draft。active run继续使用启动时冻结的record snapshot。

Update/Delete的record atomic publish是point-of-no-return。publish后lease-state refresh/release失败仍返回并广播authoritative saved/deleted result，并以lost lease outcome让client转read-only；不得把durable commit伪装成失败或让旧lease继续编辑。

Macro panel visibility只是browser-local UI布局：组件保持常驻，隐藏/显示不得清空selection、draft、JSON buffer、dirty、published-Create preservation或lease。selection/draft/JSON buffer只存在于页面内存，不写入`localStorage`、`sessionStorage`或server；browser storage只保存visibility/width等UI偏好。dirty Macro、打开的JSON Edit或published-Create preserved buffer必须触发native `beforeunload`确认，取消离开保持原内存状态，确认离开才丢弃；显式resolution后的真正clean状态解除guard。V0不恢复刷新前draft。

Macro workbench的DOM hierarchy、control顺序、compact density、nested flow overflow、run dock和1600/900/720 placement是冻结的current结构。presentation由现有element上的daisyUI semantic class与static Tailwind utility拥有，不存在Macro component `<style>`或global legacy selector。browser Theme只改变semantic presentation，不改变draft、validation、lease、Prepare或runner state；disabled/readonly/run-locked/current-node在全部theme中必须保持明显可区分。normal saved visual view的既有read-only notice本身是显式Edit入口：仅`content_edit_lease_required`时支持click/Enter/Space并调用同一个`beginEdit()`取得fresh content lease，其他lock reason与notice以外surface不得触发Edit。

`MacroInsertionPalette.svelte`导出的`MacroInsertionPaletteLifecycle`唯一拥有root与lane palette的anchored/centered viewport placement、实测clamp、first-enabled-control focus、Escape/cancel与exact trigger focus restoration。`createMacroFlowInsertionController`唯一拥有root insertion的八项rune state、anchor validity及insert/move command；它只消费live draft/mode、parent `updateDraft`/terminal-adoption ports与既有lifecycle instance，不缓存definition或复制placement算法。`createMacroFlowTreeController`继续拥有tree本域的collapse、ID reconciliation及structure mutation。Parallel lane的lookup/capability/output choice由pure policy计算，draft command只修改显式传入的definition并返回structured result；`createParallelLaneEditorController`继续唯一拥有collapsed action IDs、notice、confirm、selection reconciliation及parent提供的`updateDraft` gateway。机械拆分保留父版本的Parallel失败路径：terminal adoption在`updateDraft` callback内先于lane重查，action rename通过duplicate检查后即使目标已消失也仍reconcile collapsed ID并返回`true`；修正这些语义必须另建行为task。Flow parent继续原地拥有props、recursive DOM/render snippet和projection wiring；Parallel parent继续拥有既有DOM、lane palette state与selected-lane wiring。

Save要求persistable valid，不要求runnable或当前Room ready，不触发Prepare；成功后更新base revision、清dirty并保留当前Edit session/lease。Copy只把canonical pretty-printed definition写入clipboard；没有Duplicate、clone、copy-and-create、内建Library、Import或Export。外部保存只通过clipboard交给Gist等工具，恢复时显式New、进入JSON Edit、Paste并Save；输入必须已经符合当时的current schema，旧schema不会被自动升级。

JSON Edit以及Save/Create/Start等lock-sensitive pending operation期间editor/selector必须inert，统一draft mutation入口仍做defensive guard。异步response只有在operation/draft/controller/lease identity仍匹配时才能commit；dirty Start严格串行执行Save/Create → 必要时取得fresh record lease → 使用fresh saved revision Start。runner处于`starting | running | paused | waiting_input | stopping`时selector、visual authoring与JSON Edit必须以明确read-only surface锁定，visual fieldset使用native disabled并由mutation gateway再次拒绝；终态`completed | failed | stopped`解除run lock，随后editability仍由controller/Edit session/lease决定。

Visual authoring的text、textarea、number、checkbox与select继续同步写入`createMacroRecordSession`唯一拥有的deep rune draft；accepted mutation在当前event内原地修改现有draft并恰好递增一次`draftRevision`，不得为每个按键clone/替换完整definition，也不得增加字段级shadow buffer、debounce、blur commit或autosave。dirty使用exact path journal：只比较本次set/delete影响的path/ancestor与immutable base，不在每个按键JSON stringify或扫描整棵definition；所有changed path恢复base value后立即clean，array move/splice、New、record install、Cancel与persist success都重置正确baseline。单次mutation的recording Proxy在任何set前递归unwrap，不能被splice/move写回真实draft；反复移动后node仍是原object identity。Message text part同样通过parent mutation gateway原地更新，不在每个字符上复制整条message。artifact visibility在相关structural revision上只做一次DFS并建立按node/lane查询的index；纯正文输入不触发per-node root重扫。Node、Parallel Lane/Action/Output的persisted ID不承担editor DOM identity；逐字符rename必须保持同一input DOM、focus与caret。For(text-list)行直接以item object作为identity，父Node ID变化不得重建item card、key input或value textarea；不得使用persisted ID派生key或把stable editor identity写入schema、DOM attribute或storage。

transient WebSocket reconnect以显式`connectionGeneration`触发saved-content reconciliation，不清dirty/preserved page-memory buffer或`beforeunload` guard。新连接ready后重读record list；只有clean readonly selection可安装revision单调不退后的server truth，protected buffer只显示changed/deleted notice。list/read continuation分别由generation、connection、record identity、editor state和minimum revision约束；旧response不能覆盖新truth，transport/5xx失败不能提前消费invalidation sequence，queue做有界重试并在focus/reconnect继续drain。Create已commit而controller/connection先变化时，若submitted identity仍匹配，必须关联fresh record identity并进入read-only published-Create preservation，禁止重复Create。

实现上，`createMacroRecordSession`是selection/draft/lease及全部Svelte rune state的唯一owner、commit gateway和public assembly point。`MacroRecordNavigationCoordinator`只拥有list generation并编排list/Select/New request phase；`MacroRecordEditOrchestrator`只用单次调用局部snapshot编排fresh lease、Save/Create/Delete、JSON Save和dirty Start persist phase。两者把typed outcome交给factory的live operation/controller/record/draft/JSON/lease-aware commit ports，不缓存record/draft/lease。`MacroRecordMutationWorkflow`继续唯一编排record transport、fresh lease和persist transaction；`MacroRecordRemoteSyncCoordinator`继续只持有invalidation queue、retry timer、connection generation与serialized drain。published Create与retained lease仍在MutationWorkflow commit callback内同步进入factory，不能延迟到外层await后再关联identity。production不建立第二种saved-content session或带feature flag的generic content session。

## 显式 Prepare terminals

Macro运行区只有一个`Prepare terminals`按钮。不存在Settings toggle、Auto-prepare、Use/Activate、Start-and-prepare或selection/load/save/start/event trigger。

按钮读取当前visual draft或JSON buffer中的合法terminalLayout；New、dirty、saved以及含unassigned reference的draft均可Prepare，不要求record identity或先Save。Prepare request只携带canonical layout snapshot和expectedTerminalStructureRevision，不读取或修改MacroRecord。resolver只按顺序keep/move/create/insert缺少的shell/text，不删除、reset、等待或治疗starting/exited/failed terminal。backend失败立即停止并返回最新authoritative partial snapshot；不staging、不rollback。Prepare创建Shell使用`$HOME`，terminal/layout没有产品级数量上限。延迟HTTP response按roomRevision monotonic merge，不能回滚更晚WebSocket Room真值。

## Start、runner 与 runtime input

Start运行明确保存的MacroRecord revision；dirty Start严格串行Save/Create后使用response中的fresh revision。client与server都要求persistable、runnable、Room ready、expected record/structure revision和controller。成功后冻结definition、record revision、Room generation、structure revision以及每个index/type解析出的terminalId/launchId；Action执行期间不再按live index解析，也不重读MacroRecord。runner对任何意外unassigned做defensive fail loudly，绝不解释为空字符串、terminal 1、none、skip或continue。

runner tight loop按固定budget执行macrotask cooperative yield并在yield后复核abort/pause。terminal-quiet比较frozen launch的单调outputActivityRevision，不比较截断replay长度。Input submit先durable append event再清pending/resume，append失败保留可重试input；每个run只能提交一个终态。

structured Capture只等待同一Room generation、同一frozen terminalId/launchId通过`just submit-json`提交的第一份schema-valid JSON。每个live run最多一个pending structured waiter；没有step id、submission queue或独立端口。Pause保留waiter及已接受value，但只在Resume后完成step；Stop、Destroy、abort或restart清除。JSON If使用标准JSON Pointer：缺失目标的value comparison一律false（包括`not_equals`），equals保持scalar类型严格，number comparator只匹配number。

active run属于live Room，不属于browser。run-start、WebSocket connect/reconnect和repair发送包含最近durable tail、冻结`runningMacro {recordId, recordRevision, definition, definitionHash}`及`stateHash`的完整`runner_snapshot`；definition在Start时建立并deep-freeze一次，后续full snapshot复用同一projection，不重复clone/hash。Start/Pause/Resume/Stop/Input HTTP success只返回紧凑action ack，不返回definition或events，其中runtime input只回传invocation identity、input revision与waiting status，不回显prompt/defaultText/draft。step/current node、Pause/Resume、Waiting Input、input draft/submit、Stop和终态以最多25ms合并的`runner_delta`广播；delta只含run/definition hash、expected/new runtime revision、mutable state、新events、window metadata与合并后全量`stateHash`，不得重复发送definition。client先检查Room generation、run/definition identity、published revision与eventSeq，合并candidate后用shared canonical projection验证full logical state hash；gap/hash mismatch进入绑定Room/connection generation与本地token的single-flight HTTP完整snapshot repair。每批最多三次（立即、100ms、300ms），耗尽后保留pending并只由focus、reconnect或后续runner message继续，正常UI不polling。

Run dock独立显示高对比status badge与current stage；stage从冻结`runningMacro.definition`把`currentNodeId`解析为`type · id`，Parallel action附带lane。browser-local visual draft中存在相同node id时，对root/nested node或Parallel lane action显示明显current-node边框；不存在时不猜测、不切换selection，Run dock仍显示冻结stage。

`Editing/Viewing Macro`保持browser-local，`Running Macro`是同Room设备共享的只读冻结snapshot；收到run不得切换selector或覆盖draft。Input invocation/prompt/default/draft/revision保存在server内存，controller使用单一in-flight/latest-value coalescing更新，takeover后继续同一状态；draft正文不写Trace，server restart或Room Destroy不恢复。

Notify action在server只执行一次、生成一个notification id并向每个当前Room client广播一条`macro_notification`；Telegram也始终只发送一次。browser对message去重一次后立即呈现第1次App toast/sound，再按App channel interval调度剩余次数；System browser notification始终一次。`toast:false`或`sound:none`分别关闭对应side effect，两者均关闭时不建立App timer。reconnect、Room切换、destroy或workspace dispose必须清除seen set并取消尚未触发的repeat timer；同一notification重放不能建立第二组timer。
