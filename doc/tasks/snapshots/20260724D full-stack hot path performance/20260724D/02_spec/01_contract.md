# Full-stack Hot Path Performance Contract

## 任务边界

本任务只改变热路径调度、live transport projection、repair和Trace查询形态。MacroDefinitionV5、MacroRecord、AgentEvent、RunManifestV1、durable run event、artifact、Room controller、content edit lease、terminal identity、terminal structure revision与run evidence retention schema保持不变。

P1/P2、quietly wrong正文或runner state、capture漏收/串收、revision/hash未校验即commit、repair loop、hard action读取未flush状态、validation issue contract变化、结构操作重发完整replay、Trace无界response或任一project-authored source超过400行均阻断Close Gate。绝对毫秒只作辅助证据；主要Gate使用traversal/clone/encode次数、payload shape、索引读取次数、DOM数量上界与协议行为断言。

## 任务规范

### Macro live-draft diagnostics与dirty

#### 一次trusted traversal

Visual deep rune draft属于已建立MacroDefinitionV5 object/tree shape的trusted live state。它使用clone-free diagnostics入口，一次node traversal同时产生persistable与runnable结果。runnable-only的`unassigned_terminal_reference`和`unassigned_artifact_reference`只在persistable无其他issue时进入runnable结果，从而保持现有validation issue code、path、排序和“persistable失败时runnable返回同一组基础issue”语义。

trusted入口成功时可引用当前draft，不得clone。JSON parse、record read/write、Start frozen snapshot与其他trust boundary仍使用既有clone/strict validation。对同一`draftRevision`，Visual render、Prepare/Start disabled state和Start action必须共享同一diagnostics结果，不得分别重跑全树validator。

普通输入后的UI diagnostics允许在不超过50ms的trailing窗口合并更新；Save、Prepare、Start、切换JSON和任何读取正式validation结果的hard action必须先同步flush到当前`draftRevision`。字段值、caret、selection和正式draft mutation本身不得debounce。

#### exact path journal

`createMacroRecordSession`继续唯一拥有draft/base/dirty/revision。accepted Visual mutation同步作用于现有deep rune draft并恰好递增一次`draftRevision`。dirty tracker只记录该mutation实际set/delete的JSON path；它维护与immutable base的最小不等path集合，只重新比较受当前mutation影响的path或ancestor，不为每次按键序列化、clone或遍历完整definition。

用户把所有changed path恢复到base JSON值后必须立即clean。array splice/move、object replacement、property delete、New/no-base、record install、cancel、persist成功与published Create preservation均有明确baseline更新。journal只是比较元数据，不成为第二份可编辑真值，也不写入schema、DOM或storage。

recording Proxy只能存在于单次`apply()`调用栈，绝不能进入真实draft。任何set写入的object/array都必须沿tracker持有的weak proxy-to-target mapping递归unwrap；尤其`Array.splice()`先读取node再写回时，最终array element仍须与mutation前的原node object保持reference identity。反复move不得形成Proxy-on-Proxy、保留旧changed map或增加draft中的wrapper层。

### AgentEvent indexed store与wait

每个`serverInstanceId/roomId/roomGeneration` current JSONL在本进程第一次访问时最多完整读取、解析和严格验证一次。内存index至少包含event ID `Set`、terminal/launch bucket及agent kind/event kind/adapter精确bucket。append的duplicate check必须O(1)；matching/count/next从相应bucket读取，不再同步重读文件。

append顺序冻结为：validate exact AgentEvent → cold-load index → O(1) collision check → append完整JSON line → file fsync → 仅当本次创建目录entry时fsync parent directory → 更新index/version → 唤醒waiter。写入或durability失败不得发布event。Room/generation/terminal/launch/agent/adapter匹配、baseline count、consumed event ID和prompt/result pairing语义保持。

capture wait订阅store version notification；新append立即唤醒。100ms heartbeat只用于Pause/checkpoint、abort和active timeout核算，不读取或解析日志；index version未变化时不得重复matching traversal。Abort、Pause不计时、timeout、hook error优先级和single-consume语义保持。

### Text terminal增量同步

#### Current protocol

旧`set_terminal_text { content }`被删除。client mutation只允许：

```json
{
  "type": "mutate_terminal_text",
  "terminalId": "term_...",
  "expectedTextRevision": 12,
  "mutation": {
    "kind": "patch",
    "start": 120,
    "deleteCount": 3,
    "insert": "hello"
  },
  "resultHash": "sha256:<64 lowercase hex>"
}
```

或`mutation: { "kind": "replace", "content": "..." }`。terminal selector仍exactly one of ID/index。patch offset与`selectionStart`一致，使用JavaScript UTF-16 code unit；`start`、删除终点不得切断surrogate pair。client通过最长公共前缀和后缀产生单个连续replacement；若patch JSON成本不小于replace或changed span覆盖正文至少75%，必须发送replace。

server先检查terminal identity/type、controller guard与`expectedTextRevision`，在旧正文上产生candidate，计算candidate完整SHA-256并与`resultHash`比较。只有hash相同才atomic replace replay、更新cached hash并让text/terminal/output activity revision各前进一次。成功broadcast `terminal_text_mutation`，只携带mutation、result hash和revision fields，不携带完整正文或terminal snapshot。

revision conflict、invalid patch或result hash mismatch不commit，并只向sender发送`terminal_text_resync_required`。client随后以single-flight `request_text_snapshot`取回`terminal_text_snapshot { content, resultHash, revision fields }`。initial/full terminal snapshot中的Text replay必须带同一cached `contentHash`；Shell为`null`。client验证full content hash后安装；一次repair后的下一次mutation/full snapshot仍不一致时停止自动repair并显示稳定错误，禁止循环请求。repair budget绑定terminalId与launchId；reset后的新launch重新获得一次repair，旧launch迟到message不得消耗它。

browser Text projection在每次accepted full terminal/Room snapshot时为该terminal分配不可复用的monotonic projection token。任何mutation、repair snapshot或initial snapshot的异步hash都必须在`await`后重新读取current Room generation、projection token、backend、launchId与textRevision；任一不一致时静默丢弃旧结果，不得安装正文、请求repair、消耗新projection的repair budget或覆盖较新的非Text revision。workspace reset会清空queue/pending状态，但不得让旧token在同进程内发生ABA复用。

#### Browser调度与flush barrier

textarea的`localContent`在input event内立即更新，绝不等待timer、network或hash。网络使用100ms leading+trailing throttle；同一Text terminal最多一个mutation in flight，期间只保留latest local value。ack后从最新synced content重新计算下一patch。observer与controller都按textRevision串行应用mutation并在merge后计算完整hash。

browser仍在运行时，blur、terminal tab切换/关闭/拖拽与Start必须flush pending mutation并等待ack或明确失败；Start是当前client对可能读取Text replay的Macro执行入口，因此覆盖该run内后续Capture。突发transport断开、controller loss与browser teardown无法等待远端ack：它们必须取消本地pending write并恢复authoritative server truth，pending browser unload显示native warning。Prepare不读取Text正文，但仍不得绕过Macro自身diagnostics flush。

不引入自定义Worker。browser使用`crypto.subtle.digest`；server使用等价SHA-256。hash计算只发生在实际发送/接收mutation或full snapshot时，不发生在每个原始keypress。

#### 行号virtualization

TextBox与Macro `LineNumberedTextarea`的gutter只渲染viewport可见行加固定overscan。line number DOM数量必须与viewport高度相关，而不是与总行数相关；scroll、font、resize、manual height、wrap=off、textarea value/caret和现有line alignment保持。

### Room结构projection与broadcast

`terminal_index_map`是move/close/lock变化的authoritative structure projection。client应用accepted map时必须移除不在`items`中的terminal、修正index/order、terminal positions和lock state。move与close不得随后broadcast `room_snapshot`。

create/reset仍先broadcast该terminal的最小`terminal_snapshot`，保证后续PTY output有已知identity，再broadcast index map。Prepare在一个index-map batch内执行：中间move/create可发送必要的新terminal snapshot/output，但只在batch结束broadcast最后一份index map；HTTP success/failure response只构造并返回一次最终full room snapshot。

同一Room broadcast的JSON payload只serialize一次，再把相同string交给各client send queue。per-client control grant、direct reply和error仍可独立encode；测试adapter保持object observation能力。

### Runner incremental live protocol

#### Full snapshot

run-start、new connection、run identity变化、event gap和repair使用full `runner_snapshot`。active snapshot的`runningMacro`携带record ID/revision、完整frozen definition与`definitionHash`。snapshot还携带`runtimeRevision`、完整retained event window和`stateHash`。definition在Start时canonical serialize、SHA-256并建立一次deep-frozen live projection；后续full snapshot直接复用该projection，不再clone或rehash。普通delta不得重复发送definition。

#### Delta

普通`runner_delta`不得携带definition或完整runningMacro。它必须包含`runId`、`definitionHash`、`expectedRuntimeRevision`、新的`runtimeRevision`、全部mutable runtime fields、window metadata、新增events和`stateHash`。25ms publication coalescing保留；`expectedRuntimeRevision`指向上一次实际published revision，而不是数值上的`runtimeRevision - 1`。

client依次检查Room generation、run ID、definition hash、expected runtime revision、window/event sequence，合并mutable state和events，再验证完整logical state hash。任一不一致进入既有single-flight full runner repair；未通过hash的candidate不得安装。

`stateHash`使用shared canonical JSON projection，包含`runId`、`definitionHash`、status、current node、error、runtime input、完整retained events及first/last/total/discarded metadata；undefined按明确projection消除，object key按Unicode code point排序。full snapshot也必须通过同一hash验证。

terminal status的最后一次publication attempt settle后，无论client delivery成功、Room已销毁或projection发送失败，`MacroRunStore`都必须淘汰该run的`eventCursors`和`liveEventWindows`；durable event已经先于publication提交，后续Trace/full snapshot从durable evidence按需读取。Room destroy继续清理runtime revision与timer。

### Trace pagination与derived index

旧`GET /runner/traces`聚合全部run及event tail的response被删除。current endpoints为：

1. `GET /api/rooms/:roomId/runner/traces?limit=N&cursor=C`，返回`{ items: MacroRunSummary[], nextCursor }`；
2. `GET /api/rooms/:roomId/runner/traces/:runId/events?limit=N&cursor=C`，返回该run retained window中的一页events、window metadata与`nextCursor`。

`limit`范围分别为1..50和1..200，默认20与100；cursor opaque、绑定排序位置/run identity，invalid或foreign cursor fail loudly。summary只含run ID、createdAt、macro record、Room generation、derived terminal status和event counts，不含definition或events。

server维护可重建的derived room/run manifest index。共享User Data Root的不同server process必须通过同一cross-process lock执行fresh disk read、merge和atomic replace，不能以process-local旧cache覆盖其他process entry。已知manifest publish/remove在lock内fresh-read index、应用本次upsert/remove，再仅以manifest ID集合确认结果；该正常路径不得重新解析任一既有manifest。只有index缺失、损坏，或存在与本次已知增删无关的集合漂移时才允许cold rebuild并解析manifest。已加载index的process在查询前检查atomic file replacement generation，并在外部替换后重新读取；不得要求restart才能看见另一process的新run。

每个server process对每个run的首次cold Trace summary访问必须枚举并读取首尾segment验证`summary.json` freshness；schema合法但落后于durable JSONL时，以真实first/last event修复并atomic重写summary。进程内成功的summary checkpoint或cold verification建立fresh marker，之后正常summary page只读derived room index及该页各run的valid `summary.json`，不得枚举或读取evidence segment；同进程后续append会使该run marker失效。event page从summary window和cursor直接计算覆盖范围的segment filename，只读取覆盖该页的segment，不得先枚举segment目录、读取首尾segment、读取其他run或完整retained tail。cursor eventSeq大于该run当前`lastEventSeq`必须返回`invalid_trace_event_cursor`，不得伪装成合法空页；cold recovery、summary repair和明确maintenance path可以枚举/读取首尾segment。

Trace UI只在用户进入Trace view时请求cursor-paginated run summaries；选择run后加载该run第一event page，并提供前后页导航。Room workspace mount不得预取Trace；不能一次创建全部run badge或全部historical event DOM。selected run与当前runner identity相同时，即使runner刚从active进入completed/failed/stopped，仍继续显示其已合并的live retained window，不得瞬间退回进入Trace时抓取的旧event page。每run1000-event retention保持；本任务不删除completed run、artifact或AgentEvent。

### 局部复杂度

Macro Flow每个structural reactive revision只做一次artifact visibility DFS，产出按node/lane查询的index；node render不得各自从root重扫。纯文本值变化若不改变node topology/output identity，不得重建index。

`WebSocketSendQueue`使用head index/deque语义，出队不得`Array.shift()`；enqueue时缓存每项UTF-8 byte length，flush不得再次`Buffer.byteLength`。pending count/bytes、overflow、blocked/drain/fatal contract保持。

### Legacy Kill List

删除旧`set_terminal_text` full-body message、Text mutation成功后的完整terminal snapshot broadcast、旧Runner delta中的definition、把full snapshot当delta验证的兼容路径、aggregate Trace response、move/close后的room snapshot、AgentEvent append/list轮询读盘、每node root artifact DFS、全量line-number DOM和send queue `shift()`。

不得添加alias、protocol version fallback、dual parser、legacy response或自动旧schema转换。

## 示例

### Text mutation成功与repair

正文`abc`、`textRevision=4`变为`ab界c`时，client可提交`patch { start: 2, deleteCount: 0, insert: "界" }`、`expectedTextRevision: 4`及完整候选正文的`resultHash`。server合并后hash一致才发布revision 5的同一patch。若observer本地revision为3或合并后hash不同，它不安装candidate，只请求一次full Text snapshot；full snapshot验证成功后从authoritative正文继续。

### Runner full、delta与action ack

Start HTTP成功只返回紧凑`{ ok: true, ack: { roomId, roomGeneration, runId, runtimeRevision, status, runtimeInput } }`；`runtimeInput`只允许为`null`或`{ invocationId, inputRevision, status:"waiting" }`，不得回显prompt、defaultText或draft。input-draft client以已发送本地值和ack revision推进cursor。完整frozen definition由同一run的首个WebSocket `runner_snapshot`投影。之后普通transition只发不含`definition`/`runningMacro`的`runner_delta`。若`expectedRuntimeRevision`或`stateHash`不匹配，client通过`GET /runner`取得full repair snapshot，而不是猜测缺失delta。

### Trace两级分页

Trace先请求`GET /api/rooms/:roomId/runner/traces?limit=20`并只渲染summary page；选择`run_...`后再请求`GET /api/rooms/:roomId/runner/traces/:runId/events?limit=100`。翻页使用opaque cursor；把另一个Room或run的cursor交给当前查询必须fail loudly。

## 测试

focused测试至少证明：

1. 1000-node Visual mutation每个revision最多一次node traversal、零validation clone、dirty只比较affected path，revert立即clean；repeated splice/move保持原node identity且不把recording Proxy写入draft；hard action同步flush；
2. AgentEvent冷加载一次、1000-event后append collision为Set lookup、waiter由append唤醒、duplicate/durability/Pause/abort/timeout不变；
3. Text patch Unicode边界、replace fallback、throttle single-flight/latest coalescing、server atomic hash验证、observer hash与single repair、hard action barrier；2MiB正文连续编辑不再传输2MiB/keypress；
4. move/close只发index map，Prepare coalesce map且只构造一次HTTP room snapshot，多client broadcast只encode一次；
5. Runner delta无definition、expected revision与state hash正确，gap/hash mismatch repair，terminal cache eviction；
6. cold Trace首次访问修复stale valid summary并恢复durable tail/终态，第二次访问零segment read/list；event page只读数学计算出的覆盖segment，越过tail cursor fail loudly；已知index add/remove为零manifest parse，无关集合漂移才cold rebuild；两个独立server process并发publish不丢index entry，已加载reader观察外部atomic replacement；
7. 10,000-node artifact index不执行per-node root DFS，超长textarea line DOM有固定上界，send queue无front shift且bytes精确。

Text projection另需以controllable hash覆盖：hash进行中安装reset/reconnect snapshot（包括同launchId/textRevision）后，旧结果不得覆盖新projection或消耗其repair budget。Runner测试必须证明多次full snapshot返回同一frozen Start definition projection；Trace UI测试必须证明同一current run终态后仍选择live retained window。

最后严格顺序运行task-scoped test、check、build、unit、integration、Chromium E2E、file-size和diff-check。不得并发重命令。
