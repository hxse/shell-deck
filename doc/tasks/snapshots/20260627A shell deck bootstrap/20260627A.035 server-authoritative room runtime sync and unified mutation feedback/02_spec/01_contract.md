# 20260627A.035 Contract

## 1. 状态所有权

V0冻结以下唯一归属：

| 状态 | 真值与作用域 | 是否同步 |
| --- | --- | --- |
| 当前选择的Macro、visual/JSON draft、dirty、editor tab | browser-local | 否 |
| MacroRecord成功Create/Save/Delete后的record/revision | User Data Root | 是，saved-content invalidation |
| 当前选择的Library item与未保存draft | browser-local | 否 |
| Library成功Save/Delete后的record | User Data Root | 是，由.036消费本任务primitive |
| active run与冻结Macro definition | live Room server memory | 是 |
| status、current node、Pause/Resume/Stop、error、events | live Room server memory | 是 |
| runtime input prompt/default/draft/revision/status | live Room server memory | 是 |
| notification execution与notificationId | live Room server | 是，仅投递当时在线clients |
| Room列表 | live server process | Home自动读取 |

不存在browser-to-browser消息、localStorage runtime镜像或从Trace恢复live state的路径。

## 2. Runner authoritative snapshot与delta

### 2.1 current schema

`MacroRunnerSnapshot`破坏性切换为当前唯一schema：

```ts
type MacroRunnerSnapshot = {
  roomId: string;
  roomGeneration: string;
  runtimeRevision: number;
  runId: string | null;
  runningMacro: null | {
    recordId: string;
    recordRevision: number;
    definition: MacroDefinitionV3;
  };
  status: MacroRunnerStatus;
  currentNodeId: string | null;
  error: string | null;
  runtimeInput: null | {
    invocationId: string;
    prompt: string;
    defaultText: string;
    draft: string;
    inputRevision: number;
    status: "waiting";
  };
  events: MacroRunEvent[];
  firstAvailableEventSeq: number;
  lastEventSeq: number;
  totalEventCount: number;
  discardedEventCount: number;
};
```

删除旧`templateId`、`macroRevision`、`inputPrompt`、`inputDefaultText`字段；不得保留alias、dual reader或转换分支。`runningMacro.definition`是Start时冻结的完整definition，不在运行中重读MacroRecord。idle snapshot的`runId`、`runningMacro`、`runtimeInput`均为`null`。

`events`只包含.034冻结的最近1000条bounded durable tail，四个window字段使用绝对eventSeq/总数。`runtimeRevision`在一个Room generation内单调递增，覆盖run install、current node、status、runtime input和externally visible event变化。新run不归零。client只接受相同Room generation下revision更大的WebSocket state；完整HTTP Debug/repair snapshot可在revision相等时幂等检查，但不得回退。

### 2.2 WebSocket publish

ServerMessage新增：

```ts
{ type: "runner_snapshot"; snapshot: MacroRunnerSnapshot }
{ type: "runner_delta"; delta: Omit<MacroRunnerSnapshot, "events"> & { events: MacroRunEvent[] } }
```

* Room WebSocket注册并发送基础Room snapshot后，必须立即发送当前bounded runner snapshot；late/reconnect client由此一次取得当前truth。
* start install、step/current node、pause、resume、waiting input、input draft、submit、stop、completed、failed和run event append后只发布`runner_delta`。delta携带最新state/window metadata，但`events`只含上次Room broadcast后新增的绝对sequence event，不能重复发送历史tail。
* publish面向当前Room全部clients，不区分controller/observer。
* rapid synchronous transitions允许server在最多25ms窗口内合并为一个携带最新`runtimeRevision`的delta；delta必须包含该窗口内全部尚未broadcast的retained events，等待输入、终态等最终state不能丢失。
* client按runId、Room generation、runtimeRevision与absolute eventSeq单调merge。event出现gap、identity不一致或window metadata不闭合时，不猜测、不局部前进，进入绑定当前Room id、Room generation、connection generation与本地repair token的single-flight repair。每批最多请求`GET /api/rooms/:roomId/runner`三次：首次立即，失败后分别等待100ms、300ms重试；transient transport、5xx、JSON或invalid/stale snapshot失败在本批内不得清除repair-pending。三次均失败后停止自动timer但保留pending并提示；仅在page focus/visibility恢复、WebSocket reconnect或收到后续runner message时开启新一批。旧generation/token response不得安装。正常UI不得周期polling。
* 若server在一次publish前已经因极端快速run丢弃了尚未broadcast的旧segment，则该次直接发送完整bounded`runner_snapshot`作为显式resync，之后继续delta。
* WebSocket断线期间不做client-side推演；重连后完整snapshot覆盖本地runtime view。
* Room进入destroying/destroyed后不得发布旧generation snapshot；所有await后复核既有lifecycle ticket/generation。

`runner_snapshot`与`runner_delta`不是两套兼容schema：前者只承担connect/reconnect/gap repair的完整bounded window，后者只承担live monotonic增量。旧的“每次transition重发完整events”路径必须删除。

## 3. Running Macro与本地editor

* MacroPanel同时呈现`Editing/Viewing Macro`和只读`Running Macro`身份；两者可以不同。
* 收到runner snapshot不得修改selected record id、draft、dirty、JSON buffer、edit lease或panel tab。
* 未选择任何Macro的browser仍能显示Running Macro和完整runner状态。
* saved Macro在active run期间被Save或Delete，不改变`runningMacro`冻结definition。
* active run终态仍保留其snapshot供当前Room查看；下一次Start替换为新run。server restart不恢复。
* runner lifecycle只控制run command与terminal structure lock，不控制Macro content Edit session。`completed/failed/stopped`必须释放terminal structure lock；若Start前的Save/dirty Start仍持有合法content edit lease，则终态后visual/JSON editor继续可写，用户以`Done`显式结束Edit session。
* 同一controller browser tab reload或短暂重连后，按.033冻结的5秒non-secret intent窗口，仅在Room为`available`时执行普通epoch-bound acquire。成功后Macro New、terminal New和其他shared mutation恢复可写；不得把普通observer提升为controller，也不得自动takeover live owner。

## 4. Runtime Input

### 4.1 server state

进入Input Action时server原子创建`runtimeInput`：

* `invocationId`由server生成，绑定本次节点调用。
* `draft`初始等于`defaultText`，`inputRevision`初始为0。
* takeover、controller断连和observer连接不得清空draft。
* submit成功后`runtimeInput`变为null，run继续。
* plaintext draft不写Trace/event log；event只记录invocation id、revision和字符数等非正文元数据。

### 4.2 exact API

新增：

```text
POST /api/rooms/:roomId/runner/input-draft
{ invocationId, value, expectedInputRevision }
```

现有submit破坏性切换为：

```text
POST /api/rooms/:roomId/runner/input
{ invocationId, value, expectedInputRevision }
```

两者都必须通过controller bearer、Room generation、run/invocation和revision复核。失败使用stable code：

* `runner_not_waiting_input`
* `runner_input_invocation_mismatch`
* `runner_input_revision_conflict`
* 既有controller/Room lifecycle错误码

draft成功更新后revision递增并广播；submit在同一次server operation内用request value计算最终值与next revision，但必须先durable append `runner_input_submitted`，成功后才更新内存、清除pending resolver并恢复Running，不依赖先前draft请求已经到达。append失败保持原invocation/draft/revision与Waiting Input，可重试或由Stop取消；不得进入无法唤醒的Stopping。该顺序继承.034的single-terminal-event与cooperative runner约束。

controller client对键入更新使用单一in-flight、latest-value coalescing；不得并发发送一串相同expected revision。conflict时安装server snapshot并基于用户仍未提交的latest local value继续串行发送。失去control时停止发送但保留server已确认draft。

## 5. Saved-content invalidation

ServerMessage新增generic消息：

```ts
{
  type: "content_record_changed";
  resourceKey: ContentResourceKey;
  operation: "saved" | "deleted";
  revision: number | null;
}
```

* MacroRecord create/update/delete transaction成功提交后，由当前server process广播给全部已连接clients。Update/Delete的record publish是.033 point-of-no-return；publish后lease-state维护失败仍属于成功commit，必须广播authoritative revision/delete并在HTTP response返回lost lease outcome。只有record本身未publish的失败才不得广播。
* `.036` Library record必须复用同一消息，不新增Library专用同步协议。
* receiver刷新record list。若当前selected saved record clean且未处于编辑/pending/published-Create preservation状态，可安装最新record；dirty、JSON editing、edit lease active或published-Create preserved时绝不覆盖draft。发起mutation的browser以HTTP response为该次请求的commit response，但它不是忽略更晚server event的授权：broadcast在local operation pending期间必须按`sequence`进入consumer queue，只有完成分类和消费后才可推进handled watermark；operation settle后必须顺序replay，不能在handler入口因pending而永久丢弃。
* replay按resource identity、operation与revision分类。当前record revision相同或更旧的`saved`是自身ack/stale event并忽略；更高revision的`saved`与`deleted`是真实remote invalidation。即使旧HTTP response随后成功返回，也不得清除更晚invalidation；本地submitted/dirty/JSON/edit-lease-lost/published-Create preserved buffer继续保留并显示准确的changed/deleted提示，不能把旧response显示成当前saved truth。只有无本地编辑上下文且无preservation state的clean readonly view才可自动安装最新record。
* Delete不改变其他browser的selector；若其当前clean view指向已删除record，显示deleted/unavailable状态，用户自行选择其他record。
* 消息不携带selector、draft或clipboard内容。
* 多server process共享文件但不在本任务建立cross-process live WebSocket fanout；focus/reload仍读取User Data Root最新record。

transient WebSocket reconnect必须产生显式`connectionGeneration`并执行saved-content reconciliation。断线/重连不得清除页面内存中的dirty、JSON edit、lease-lost或published-Create preservation，也不得解除App唯一的`beforeunload` guard。每次新连接ready后必须重新读取Macro list；仅clean readonly selection可按不低于当前revision的server record自动更新，protected buffer只更新changed/deleted notice，绝不覆盖。真正离开Room进入Home/unmount时才对Macro/Library dirty聚合状态做对称清理，Home不得残留phantom unload guard。

Macro list与selected-record read分别使用单调generation。旧response、旧connection continuation或低于当前/目标revision的response不得安装；读取结果必须显式分类为`applied | stale | retry`。transport/5xx失败不得消费`content_record_changed` sequence，event留在queue并做有界重试，之后仍可由reconnect/focus继续drain；只有完成分类和应用后才能推进watermark。Create已在server提交时，即使controller epoch或connection在HTTP response返回前变化，只要submitted draft identity未变，client仍必须关联fresh record identity并进入read-only published-Create preservation，不能继续把它当无ID New而重复Create。

首次Create已由server publish、但A未保留fresh-record edit lease时，A必须进入独立preservation state；该state不是`dirty`或`leaseLost`的兼容写法。它必须参与App唯一native `beforeunload` guard，直到用户显式New、Select或Edit latest解决；remote event、focus/background list refresh不得自行解除。

确定性竞态测试必须覆盖：A的Save已经server commit但HTTP response被延迟，B takeover edit lease后分别Save更高revision与Delete，再释放A response；A必须保留本地buffer并显示最终remote invalidation。还必须延迟首次Create response并覆盖B先Save/Delete，验证preserved buffer触发`beforeunload`，显式Edit latest或Select none后guard解除。仅有A自身相同revision ack时不得误报，所有ordering必须由commit/revision/selector等可观测barrier证明，不得用timeout猜测。

## 6. Unified mutation feedback

建立单一`SharedMutationFeedback`错误映射和Notice/Toast presenter。以下入口的client预检查与server拒绝必须走同一映射：

* terminal input、Text edit、New/Remove/Reset/Reorder terminal。
* Macro New/Edit/Save/Delete/Prepare和JSON Save。
* Start/Pause/Resume/Stop。
* runtime input draft/submit。
* .036 Library New/Edit/Save/Delete/Load的调用边界。
* 其他明确改变shared Room或saved record的control。

规则：

* 默认显示3秒；hover暂停剩余时间，mouseleave继续。
* 文本可选择、可复制；点击toast外部立即关闭。
* 新toast替换当前普通denial；Macro notification按现有详情显示，不被误映射成denial。
* Take Control成功后清除`room_control_required`类只读提示。
* server `terminal_error`、HTTP stable error和client guard统一映射；未知code保留code与安全message供诊断。
* validation invalid、operation pending、structure locked、content lease、observer、Room destroying必须是不同原因。
* 保护数据的field可以readonly/inert；可见shared mutation按钮不得只靠HTML disabled吞掉点击。采用`aria-disabled`/guarded handler，使拒绝操作能显示反馈，同时保持原视觉语言和键盘语义。
* 纯browser-local操作（选择Macro、切换tab、collapse、scroll、copy）不要求controller，也不得弹readonly toast。

## 7. Take Control文案

确认框必须表达：

> Take control of this Room? Shared terminals and the active Macro run stay on the server and will not be lost. The other connected device becomes read-only. Its unsaved browser-local Macro or Library draft remains on that device, but it cannot save shared changes until it takes control again.

禁止再声称“未保存内容可能丢失”。接管只改变server writer；不清空Room state，也不跨browser搬运未保存draft。

## 8. Home自动更新

Home删除手动`Refresh`按钮。Svelte 5 `$effect`负责registry读取生命周期：

* 当前route为Home且`document.visibilityState === "visible"`时立即读取并启动1000ms interval。
* 离开Home、页面hidden或组件销毁时cleanup interval。
* window focus或visibility恢复为visible时立即读取并重建interval。
* 同一时刻最多一个request；快速route/visibility变化通过generation忽略stale response。
* 请求失败显示现有Home error/notice，但下一interval可恢复；不得因为一次失败永久停止。

这只是browser读取server registry，不是browser间同步，也不需要新增Home WebSocket。

## 9. Notification投递

* Notify Action只在server runner执行一次并生成唯一`notificationId`。
* Telegram channel由server调用一次；失败按既有Macro action策略进入run event/error。
* App toast/sound消息广播到执行时连接同Room的全部clients。
* System notification由每个当时在线、已授权的browser各显示一次。
* 每个browser按`roomGeneration + notificationId + channel`去重；controller身份不影响接收。
* 后进入或重连的browser不补弹旧通知，但Trace仍可显示notification event。
* notification profile/token文件继续按既有独立配置处理，不进入Macro或本任务storage redesign。

## 10. 双标签页验收

同一browser context打开两个完全相同的Room URL即可作为多设备等价测试：

1. Tab A为controller，Tab B为observer。
2. A Start后B不选择Macro也收到同一个Running Macro、Running/current node。
3. B Take Control，A立即readonly，共享terminal和run不变化。
4. B Pause/Resume，两个tab收到相同revision/status。
5. run进入Waiting Input，两个tab看到相同prompt/default/draft。
6. B键入draft，A收到server确认后的相同draft；B submit后两端继续运行。
7. 关闭全部tab后server继续；新Tab C进入原URL立即收到当前live snapshot。
8. Notify执行一次：Telegram mock一次，两个在线tab的App/System各一次，后进Tab不补弹。

额外测试必须覆盖older revision ignored、takeover期间在途draft被拒绝、saved record push不覆盖dirty draft、Home hidden cleanup和shared mutation toast hover/outside dismiss。

## 11. Hard cut与实现保护

* 删除runner 900ms polling和旧snapshot字段；不得保留feature flag、legacy parser或dual event path。
* server是runtime唯一真值；client不得自行推进status/current node或以local input作为已确认状态。
* `.031/.034`既有Macro视觉、editor interaction和terminal chrome默认保护。只修改本contract点名的Running Macro、feedback、Home和runtime input局部。
* `.036`只消费本任务通用primitive；不得把Library业务提前塞入`.035`。

## 12. `.031B`行为基线演进

`.031B` change内的历史清单冻结`.031A`，后继change不得回写它；本任务只在自己的revision新增current snapshot与current journey。`.035`相对`.034`唯一预期的既有控件删除是Home手动`Refresh`，由本contract第8节的自动刷新替代。Macro视觉编辑、terminal chrome、Home Room lifecycle和其余可交互控件仍须保持。

current source inventory必须做到所有可交互控件均有稳定归属，未识别控件为0；完整UI journey必须继续从空Room仅通过UI创建Shell/Text和复杂Macro，覆盖Save、Prepare、运行、Pause/Resume、runtime Input、Notify、Trace与修复路径。因saved record改为server-authoritative异步确认，journey应等待Save确认与fresh record identity，不得用固定延时或本地selector假定掩盖协议时序。
