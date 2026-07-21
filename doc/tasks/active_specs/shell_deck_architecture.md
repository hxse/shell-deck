# Shell Deck Architecture

## 当前边界

shell-deck 是一个 local-first、terminal-first workspace。一个 server process 可以承载多个由 `/<roomId>` URL 选择的 live Room；同一用户可通过多个标签页或设备连接同一 Room并同步terminal state，但server强制一个Room同时只有一个controller，其他连接只读观察。产品不建立多人协作或Project/target-directory模型。

Room、terminal、Text content、replay、client、runner cursor 与 run snapshot 都只存在于当前 server process。长期 MacroRecord、Trace/artifact、AgentEvent evidence、Library和 notification config 位于同一 OS 用户的 User Data Root，不与 Room URL、server cwd 或 Shell cwd 绑定。

## 路由

* 零 Room 时 `GET /` 原子创建随机 Room 并 `302` 到 `/<roomId>`。
* 已有 Room 时 `GET /` 显示 Home；Home 可列出、New、Open、Destroy，固定容量为 32 个 live Room。
* canonical WebSocket 为 `/ws/rooms/:roomId`；canonical Room API 为 `/api/rooms/**`。
* 合法旧 URL token 可 lazy-create 同 token 的新 generation；server restart 或 Destroy 后不恢复旧 runtime。
* `/r/**`、`/p/**`、`/api/configs/**`、`?configId=` 与旧 `/ws?configId=` 均未注册。

被 Destroy 的 Room page 收到 `room_destroyed` 后用 browser history 在本地切到 Home并读取 `/api/rooms`，不重新请求 `/`；因此最后一个 Room 被销毁时 Home 可以稳定显示 empty state。用户主动 reload 根 URL 时仍执行零 Room 自动首建。

## 生命周期与隔离

Room identity 是 `serverInstanceId + roomId + roomGeneration`。生命周期为 `active -> destroying -> destroyed`。所有 Room mutation 先取得 generation-bound ticket；Destroy 先关闭 admission 并 abort，再 drain 已取得的 ticket，最后关闭 PTY/client 并移除 Room，因此异步操作不能在销毁后重新发布 terminal 或 run state。

Room runtime message只广播到同一Room。Room controller是process-local memory state并随generation销毁；shared mutation先取得lifecycle ticket，再验证owner control epoch/lease。Home lifecycle管理是唯一不要求目标Room controller的外部入口。

浏览器之间从不直接同步。terminal、runner、runtime input和notification全部先进入server-owned Room state，再由Room WebSocket投影到各连接；关闭browser不会停止server runner。Macro/Library selector和未保存draft保持browser-local，saved record通过user-global store与generic content invalidation同步，不能与Room runtime混成一份状态。

长期user content不属于Room。saved Macro/Library record另由`.033`跨Room/process的per-record content edit lease与expected revision共同保护；controller和content lease是两层正交primitive，不能互相替代。

## Macro 与 runner

production Macro采用`MacroDefinitionV5`与`MacroRecord` envelope分层。definition只表达portable Flow、连续terminal index/type及exact assigned/unassigned logical references；record metadata由user-global store生成。Macro selection是单个browser的editor状态，新Room默认null selection，不改变Room terminal。

terminal layout只有用户点击Macro面板的`Prepare terminals`才会调整；Settings、selection、Save、Library Load、Start和terminal event都不隐式Prepare。Save只做portable validation。Start在authoritative structure queue内复核record revision、terminal structure revision、type与readiness，并冻结完整definition及index到terminalId/launchId映射；运行中不重读record或live index。

runner把manifest、append-only events和artifacts持久化为只读Trace evidence，但cursor、Pause/Resume状态、pending input、run snapshot和structure lock只在live process内。日志从不恢复runner。

正常runner UI不polling。连接/重连收到完整、revisioned runner snapshot，后续状态由server push；Running Macro是Room共享的冻结只读配置，不覆盖各browser本地正在查看或编辑的Macro。runtime input draft也由server内存持有并在single-controller takeover后继续。

## 启动与安全

所有入口通过 `justfile`。`just start` 先构建 production assets；`just dev` 使用 Vite HMR 并把 API/Room WebSocket 交给 Bun server。`.032` 不暴露尚未接入 runner 的 mock/real parser server mode。默认只绑定 `127.0.0.1`；非本地 bind 必须显式设置 `SHELL_DECK_ALLOW_LAN=1`，当前没有认证。
