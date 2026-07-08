# Problem Context

`.020` 已经把用户可见命名统一成 `Target tab` / `Source tab` / `Lane tab`，并把默认 alias 收敛为 `shell_N` / `text_N`。但 Macro editor 仍把 shell/fake/real tab 和 text tab 放进同一套控件里，导致 UI 暴露一些对 text tab 没意义的选项。

典型问题：

* `wait.mode = terminal-quiet` 可以选择 `text_1`，但 text tab 没有 PTY output quiet 的语义。
* `capture-source` 选择 text tab 时仍显示 `terminal-buffer` / `agent-event`，但 text tab 只能走 `text-box` capture。
* `parallel` lane 绑定 text tab 后，lane 内仍能添加/配置 `terminal-quiet` wait 和 shell-only capture。

这不是 runner 能不能兜底的问题，而是 editor 应该在用户配置阶段就表达 tab 能力边界。

## Design Principle

Macro template JSON 继续保存结构化 `terminal` refs；用户界面使用 tab 语言。UI 通过当前 `indexMap + terminal snapshots` 解析目标 tab backend，并按 capability 控制可见选项、默认值和 preflight validation。
