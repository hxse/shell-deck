# Macro V5 Contract

## Definition、Record 与 exact references

唯一current格式是`MacroDefinitionV5`：`schemaVersion`必须精确为`5`，并包含`name`、`description`、`terminalLayout`与`body`。`terminalLayout`只保存从1开始连续的terminal `index/type`；definition不保存record metadata、Room/server identity、cwd、terminalId、launchId、alias或旧configId。

持久化envelope是`MacroRecord`：server生成`tmpl_` id、revision、createdAt、updatedAt，并把definition放在`definition`字段中。JSON editor、clipboard Copy与Library Macro JSON只处理definition，不处理record envelope。

运行所需terminal slot使用exact union：

```ts
type MacroTerminalReference =
  | { kind: "terminal_index"; index: number }
  | { kind: "unassigned" }
```

该字段名固定为`terminal`，用于root Send/Input/terminal-quiet Wait、Capture config与Parallel lane。lane内Action继承lane terminal。required artifact slot使用`StepArtifactSource | {kind:"unassigned"}`，只覆盖If/Elif condition、root/lane Extract及Send/Notify artifact message part。Message artifact的`source`必须存在。`Input.defaultSource`仍是optional assigned-only；Parallel Output的`{kind:"none"}`仍表示明确不输出，不等同unassigned。

AgentEvent Capture还必须保存exact wait policy：

```ts
type AgentEventWaitLimit =
  | { kind: "unbounded" }
  | { kind: "timeout"; timeoutMs: number }
```

新建AgentEvent Capture默认unbounded。timeout branch要求positive integer毫秒并在到期时fail；其他Capture kind不得携带`waitLimit`。

这是current-schema-only hard cut。V4及更早definition、primitive `terminalIndex` persisted field、physical target、空stepId placeholder、missing artifact source、missing waitLimit、alias、migration、adapter、dual validator与自动转换均不存在；旧输入必须fail loudly。

## 三层 Validation

`src/lib/macro/macroDefinitionValidation.ts`是唯一validation gateway：

1. `validateMacroDefinitionV5(input)`与`parseAndValidateMacroDefinitionJson(text)`检查可持久化的exact schema、Flow语义、assigned terminal layout/capability、assigned earlier artifact、template与regex。白名单slot中的exact`{kind:"unassigned"}`合法，不产生persistable issue。
2. `validateRunnableMacroDefinitionV5(input)`在persistable基础上为每个未指派slot返回stable `unassigned_terminal_reference`或`unassigned_artifact_reference` path。它不读取Room、不改写definition。
3. live runtime validator只接收runnable definition，再检查当前Room的index/type、terminalId/launchId binding与readiness。

assigned但missing/future/wrong artifact或assigned terminal缺layout/capability mismatch仍是invalid definition，不能自动降级为unassigned。Macro/JSON/Library Save使用第1层；Start严格按persistable→runnable→live Room执行。server Start对not-runnable返回`macro_not_runnable`及issues，零run安装、零terminal mutation、零`run_started`。

`parseAndValidateMacroTerminalLayoutFromDefinitionJson(text)`只供显式Prepare从当前JSON buffer读取layout；它没有last-valid fallback，也不让无关body错误阻止layout Prepare。

## Visual authoring

Visual editor不展示独立Terminal layout section。eligible terminal/artifact selector第一项始终是可选择的`Unassigned`。凡selector允许Unassigned，新建Action、切换出一个新引用slot、添加If/Elif或Parallel lane时一律默认写入exact `{kind:"unassigned"}`，即使当前已有compatible terminal或earlier compatible artifact也不自动代选。用户只有显式选择才形成assigned reference，也可以从assigned显式切回Unassigned；实现不猜测terminal 1、不自动选择earlier/future/sibling producer、不创建资源，也不隐式Prepare。

unassigned使用amber局部warning并明确“Save is allowed, Start requires assignment”；它不是red persistable error。Macro总体portable Validation可为success，而Start通过runnable completeness单独禁用并显示未指派数量。

用户选择assigned terminal时，同一次draft mutation从既有layout尾部到所选index复制连续`index/type` prefix，再更新reference；每次visual mutation递归扫描assigned terminal references，并裁掉最高引用后的unused layout tail。unassigned不贡献layout。New/delete/reorder/readiness等terminal event只刷新候选和runtime validation，绝不改写draft；terminal创建后仍要求用户显式选择。

结构Add/Move只受body/branch/lane结构规则约束。If/Elif/Extract没有earlier artifact时仍必须插入，并以unassigned source成为可保存但不可运行的draft。结构变更令既有assigned source失效时保留错误引用并显示persistable issue，直到用户修复或显式改为Unassigned。

JSON editor保持纯文本语义，不读取Room、不补引用或wait policy。JSON Save使用V5 persistable gateway；合法unassigned与exact waitLimit必须原样round-trip。

## CRUD 与 editor lifecycle

production surface只提供list/create/read/update/delete。Create/Update/Delete必须通过Room controller；既有record的Edit/Update/Delete还必须持有per-record content edit lease并匹配expected revision。Delete可从read-only selected record直接发起，但操作内部仍须acquire/takeover lease、重读current record并按expected revision删除。

List逐record扫描并只为current V5生成summary。V4及更早definition、invalid envelope或损坏JSON不读取、不迁移，只作为`invalidRecords` id/error诊断返回；它们不得令其他valid record从selector消失。Macro UI持续显示该诊断，显式Read invalid record仍fail loudly。清理旧文件采用明确删除，不提供legacy reader、migration或自动转换。

New是browser-local draft，新Room默认不选Macro；New/editing期间selector与New保持可用，dirty切换走discard确认。selector首个`Select macro`空值option是可选的显式null selection：clean时清除selected/base/draft并回到`No macro selected`，dirty时遵守同一discard确认且拒绝时恢复native value；它不Delete/Save/Prepare或影响active run。New首次Create后必须按fresh record identity取得lease才继续编辑；竞争失败时保留submitted buffer、转read-only并进入独立published-Create preservation state，直到显式New/Select/Edit latest解决。selection、visual/JSON draft、dirty与editor tab不跨browser同步。成功Create/Save/Delete后的record是user-global saved state；generic `content_record_changed`在local operation pending期间按sequence排队，settle后才按record/revision replay并推进消费状态。相同或更旧revision是ack/stale event；更高revision与Delete必须更新saved-truth提示，但不得切换其他browser selector或覆盖submitted/dirty/editing/lease-lost/published-Create preserved draft。active run继续使用启动时冻结的record snapshot。

Update/Delete的record atomic publish是point-of-no-return。publish后lease-state refresh/release失败仍返回并广播authoritative saved/deleted result，并以lost lease outcome让client转read-only；不得把durable commit伪装成失败或让旧lease继续编辑。

Macro panel visibility只是browser-local UI布局：组件保持常驻，隐藏/显示不得清空selection、draft、JSON buffer、dirty、published-Create preservation或lease。selection/draft/JSON buffer只存在于页面内存，不写入`localStorage`、`sessionStorage`或server；browser storage只保存visibility/width等UI偏好。dirty Macro、打开的JSON Edit或published-Create preserved buffer必须触发native `beforeunload`确认，取消离开保持原内存状态，确认离开才丢弃；显式resolution后的真正clean状态解除guard。V0不恢复刷新前draft。

Save要求persistable valid，不要求runnable或当前Room ready，不触发Prepare；成功后更新base revision、清dirty并保留当前Edit session/lease。Copy只把canonical pretty-printed definition写入clipboard；没有Duplicate、clone、copy-and-create、Import或Export。Macro toolbar另有明确的`Save to Library`跨domain action：它把当前persistable-valid visual draft创建为fresh Macro JSON Library item，不修改Macro record/selection/dirty，也不Prepare/Start；这不改变Copy的clipboard-only语义。

JSON Edit以及Save/Create/Start等lock-sensitive pending operation期间editor/selector必须inert，统一draft mutation入口仍做defensive guard。异步response只有在operation/draft/controller/lease identity仍匹配时才能commit；dirty Start严格串行执行Save/Create → 必要时取得fresh record lease → 使用fresh saved revision Start。run终态释放terminal structure lock，Macro editability仍由Edit session决定。

transient WebSocket reconnect以显式`connectionGeneration`触发saved-content reconciliation，不清dirty/preserved page-memory buffer或`beforeunload` guard。新连接ready后重读record list；只有clean readonly selection可安装revision单调不退后的server truth，protected buffer只显示changed/deleted notice。list/read continuation分别由generation、connection、record identity、editor state和minimum revision约束；旧response不能覆盖新truth，transport/5xx失败不能提前消费invalidation sequence，queue做有界重试并在focus/reconnect继续drain。Create已commit而controller/connection先变化时，若submitted identity仍匹配，必须关联fresh record identity并进入read-only published-Create preservation，禁止重复Create。

## 显式 Prepare terminals

Macro运行区只有一个`Prepare terminals`按钮。不存在Settings toggle、Auto-prepare、Use/Activate、Start-and-prepare或selection/load/save/start/event trigger。

按钮读取当前visual draft或JSON buffer中的合法terminalLayout；New、dirty、saved以及含unassigned reference的draft均可Prepare，不要求record identity或先Save。Prepare request只携带canonical layout snapshot和expectedTerminalStructureRevision，不读取或修改MacroRecord。resolver只按顺序keep/move/create/insert缺少的shell/text，不删除、reset、等待或治疗starting/exited/failed terminal。backend失败立即停止并返回最新authoritative partial snapshot；不staging、不rollback。Prepare创建Shell使用`$HOME`，terminal/layout没有产品级数量上限。延迟HTTP response按roomRevision monotonic merge，不能回滚更晚WebSocket Room真值。

## Start、runner 与 runtime input

Start运行明确保存的MacroRecord revision；dirty Start严格串行Save/Create后使用response中的fresh revision。client与server都要求persistable、runnable、Room ready、expected record/structure revision和controller。成功后冻结definition、record revision、Room generation、structure revision以及每个index/type解析出的terminalId/launchId；Action执行期间不再按live index解析，也不重读MacroRecord。runner对任何意外unassigned做defensive fail loudly，绝不解释为空字符串、terminal 1、none、skip或continue。

runner tight loop按固定budget执行macrotask cooperative yield并在yield后复核abort/pause。terminal-quiet比较frozen launch的单调outputActivityRevision，不比较截断replay长度。Input submit先durable append event再清pending/resume，append失败保留可重试input；每个run只能提交一个终态。

active run属于live Room，不属于browser。server在WebSocket连接后立即发送一次包含最近durable tail的完整`runner_snapshot`；Start、step/current node、Pause/Resume、Waiting Input、input draft/submit、Stop和终态只广播state与新增event的`runner_delta`，rapid transition最多在25ms内合并。两者带Room-generation内单调`runtimeRevision`、冻结`runningMacro {recordId, recordRevision, definition}`、status/current node/error、runtime input和absolute event window metadata。client忽略旧revision并按eventSeq合并；发现gap时进入绑定Room/connection generation与本地token的single-flight HTTP完整snapshot repair，每批最多三次（立即、100ms、300ms），耗尽后保留pending并只由focus、reconnect或后续runner message继续，正常UI不polling。

`Editing/Viewing Macro`保持browser-local，`Running Macro`是同Room设备共享的只读冻结snapshot；收到run不得切换selector或覆盖draft。Input invocation/prompt/default/draft/revision保存在server内存，controller使用单一in-flight/latest-value coalescing更新，takeover后继续同一状态；draft正文不写Trace，server restart或Room Destroy不恢复。
