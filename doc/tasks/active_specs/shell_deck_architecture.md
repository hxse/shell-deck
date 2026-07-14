# Shell Deck Architecture

## 当前边界

shell-deck 是一个 local-first、terminal-first workspace。一个 server process 可以承载多个由 `/<roomId>` URL 选择的 live Room；同一用户可通过多个标签页或设备连接同一 Room 并同步 terminal state。产品不建立多人协作或 Project/target-directory 模型。

Room、terminal、Text content、replay、client、runner cursor 与 run snapshot 都只存在于当前 server process。长期 MacroRecord、Trace/artifact、AgentEvent evidence、Library（后继任务）和 notification config 位于同一 OS 用户的 User Data Root，不与 Room URL、server cwd 或 Shell cwd 绑定。

## 路由

* 零 Room 时 `GET /` 原子创建随机 Room 并 `302` 到 `/<roomId>`。
* 已有 Room 时 `GET /` 显示 Home；Home 可列出、New、Open、Destroy，固定容量为 32 个 live Room。
* canonical WebSocket 为 `/ws/rooms/:roomId`；canonical Room API 为 `/api/rooms/**`。
* 合法旧 URL token 可 lazy-create 同 token 的新 generation；server restart 或 Destroy 后不恢复旧 runtime。
* `/r/**`、`/p/**`、`/api/configs/**`、`?configId=` 与旧 `/ws?configId=` 均未注册。

被 Destroy 的 Room page 收到 `room_destroyed` 后用 browser history 在本地切到 Home并读取 `/api/rooms`，不重新请求 `/`；因此最后一个 Room 被销毁时 Home 可以稳定显示 empty state。用户主动 reload 根 URL 时仍执行零 Room 自动首建。

## 生命周期与隔离

Room identity 是 `serverInstanceId + roomId + roomGeneration`。生命周期为 `active -> destroying -> destroyed`。所有 Room mutation 先取得 generation-bound ticket；Destroy 先关闭 admission 并 abort，再 drain 已取得的 ticket，最后关闭 PTY/client 并移除 Room，因此异步操作不能在销毁后重新发布 terminal 或 run state。

Room runtime message 只广播到同一 Room。长期 user content 不属于 Room；其 single-writer/control enforcement 由 `.033` 接入。

## 启动与安全

所有入口通过 `justfile`。`just start` 先构建 production assets；`just dev` 使用 Vite HMR 并把 API/Room WebSocket 交给 Bun server。`.032` 不暴露尚未接入 runner 的 mock/real parser server mode。默认只绑定 `127.0.0.1`；非本地 bind 必须显式设置 `SHELL_DECK_ALLOW_LAN=1`，当前没有认证。
