# 20260627A.035 Server-Authoritative Room Runtime Sync And Unified Mutation Feedback

## 任务概括

在.032-.034已经建立的Room、single-controller、MacroRecord和memory-only runner之上，收口同一Room多标签页/多设备的运行时同步。浏览器之间不直接同步；每个浏览器只订阅同一个server-owned Room state。关闭全部浏览器后runner仍继续，重新进入相同Room URL时由server发送完整当前snapshot。

本任务同时消除两类误导交互：Home手动Refresh改为Svelte 5 `$effect`生命周期内的自动读取；observer或失去lease的写操作不再表现为“点击没反应”，而是通过统一、可复制、可暂停消失的toast说明拒绝原因。Take Control只转移写权限，不清空共享terminal或active run，也不删除另一设备browser-local的未保存draft。

## 正式 task 级别及定级原因

三星任务。

本任务改变runner WebSocket协议、runtime input ownership、Macro saved-record invalidation、跨标签页controller交互、通知投递以及大量shared mutation反馈入口。必须同时验证server restart边界、takeover竞态、snapshot revision顺序和双标签页E2E；只改UI polling或单个按钮不能闭合。

## 范围内

* 建立Room-scoped、server-authoritative `runner_snapshot` WebSocket消息和单调`runtimeRevision`。
* 新连接/重连立即收到当前run完整snapshot；正常运行删除900ms polling，HTTP GET仅保留Debug Refresh。
* active run snapshot携带冻结Macro identity/revision/definition，并与browser-local Editing/Viewing Macro分开呈现。
* 冻结runner终态、terminal structure lock、Macro Edit session三者的独立生命周期：`completed/failed/stopped`释放structure lock，但不得把仍持有合法content lease的Macro editor变成read-only；同一controller tab刷新后沿用.033的短窗口普通re-acquire恢复写权限。
* runtime input的prompt、default、draft、revision和waiting/submitted状态全部归server内存；draft更新、takeover与submit对所有Room clients可见。
* MacroRecord成功Save/Create/Delete后广播generic saved-content invalidation；刷新record内容但不同步selector或覆盖dirty draft。该primitive供.036 Library复用。
* Home删除手动Refresh；页面可见时每秒读取Room registry，隐藏时停止，focus/visibility恢复时立即读取。
* 建立统一shared-mutation denial toast，覆盖terminal、Macro、runner、runtime input和后继Library调用边界。
* 修正Take Control确认文案，准确区分server共享状态与browser-local未保存draft。
* 冻结Notify Action：Telegram server-side一次；App/System面向当时连接Room的每个浏览器一次；后进入的浏览器不补弹。
* 增加相同Room URL双标签页E2E，覆盖observer、takeover、Running/Paused/Waiting Input、draft/submit和重连snapshot。
* 增加Save/dirty Start→completed→继续编辑以及controller reload后Macro New恢复可写的真实浏览器回归。

## 范围外

* 不同步Macro/Library当前selection、visual/JSON draft、折叠状态、panel width或其他browser-local UI。
* 不实现Library panel、Library CRUD/Load/search；由.036完成。
* 不引入CRDT/OT、多人身份、presence或并发writer；仍是同一用户的single-controller接续操作。
* 不持久化Room、runner cursor、runtime input或run snapshot；server restart后旧Room generation/run不能恢复。
* 不从Trace/event log恢复runner，不重放旧App/System通知。
* 不建立cross-process live Room federation。user-global文件仍可由多个server process共享，但本任务的WebSocket live push只属于当前process。
* 不改变MacroDefinitionV3、Prepare算法、terminal binding或Notification profile/token配置。
* 不重画Macro/terminal既有UI；只增加Running Macro状态、反馈和本contract需要的局部控件行为。

## 决策归属

人工已拍板：

* 所有同步以server为唯一中枢，禁止browser-to-browser同步。
* Macro selection、编辑和未保存draft不同步；Save/Delete后的record同步。
* active run、冻结Macro、runner状态和runtime input在同一Room全部同步。
* Library selection/draft不同步，Save/Delete后的record同步；具体业务由.036实现。
* 同一Room多设备不是多人协作，不允许并发写；Take Control只切换writer。
* Home删除Refresh并自动更新；shared mutation被拒绝必须有统一toast。
* Telegram只发送一次，App/System通知由每个当时在线且有权限的浏览器各自呈现。

AI可直接实现：

* protocol、runner revision/publish、runtime input coalescing/revision、saved-content invalidation、Home effect、toast primitive、通知去重和自动化Gate。

需要人工拍板：无。
