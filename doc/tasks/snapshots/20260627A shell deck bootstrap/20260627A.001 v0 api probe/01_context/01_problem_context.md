# Problem Context

V0 parser 不应该解析 TUI 屏幕流，而应该解析 agent 输出。Codex Stop hook 能提供 `last_assistant_message`，但要让 shell-deck 正确知道这条 agent 输出来自哪个 terminal，需要让 hook 回传 stable terminal id。

直接要求用户改 `~/.codex/config.toml` 不合适。用户直接运行普通 `codex` 时应该保持原生行为；只有在目标项目目录中通过 shell-deck `justfile` 运行 `codex` recipe 时，才自动注入 shell-deck hook。`codex` recipe 需要透传用户所有 Codex 参数，让用户仍然可以运行 `just -f <shell-deck-root>/justfile -- codex`、`just -f <shell-deck-root>/justfile -- codex resume --last`、`just -f <shell-deck-root>/justfile -- codex --model ...` 等原生用法。


`orch-web` 已经验证过 browser terminal 的一组底层行为：后端 PTY 是显示真值，多个浏览器 tab 共享同一后端 session，late client 先收到 replay，再收到实时 output，默认无锁输入可以从多个 tab 写入，real PTY 支持输入、Ctrl-C、resize、exit 和 reset 事务边界。`20260616A.012 terminal input latency stabilization` 还验证了 helper stdin pipe 比 command-file polling 更适合作为 real PTY 控制通道。shell-deck 应该吸收这些 terminal API 结论，并在 `.001` 重新 probe 一遍，避免 `.002` 才发现 API 路线不稳。

但 `orch-web` 的 role、role_call、validator-call、caller proof、sealed instruction 和 wait/collect policy 不进入 shell-deck V0 核心。shell-deck 的核心对象是 config、terminal、macro template、run log、AgentEvent 和 parser soft signals。`.001` 的 API probe 因此要把 `orch-web` 的 role 维度替换成 `configId + terminalId`，只保留 terminal truth、multi-client sync、hook event 和 evidence log 这些底层工程经验。

terminal 序号不应该作为 hook contract。序号是当前 config 下给用户看的动态选择器，移动或重排 terminal 时可以变化；stable `terminalId` 才是 hook、runner 和 event log 的身份。`.001` 因此只需要验证 hook 能不能通过环境变量带回 `configId`、`terminalId`、`launchId` 和必填 Codex `session_id`。
