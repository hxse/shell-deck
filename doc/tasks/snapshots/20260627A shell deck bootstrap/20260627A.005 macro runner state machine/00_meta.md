# 20260627A.005 Macro Runner State Machine

## 任务概括

交付最小 macro runner 状态机。完成后，宏可以基于 `.004` 的 run log 执行 `send_line`、`wait`、`sleep`、`input_line`、`capture-source`、`parse` stub、`branch`、`goto`、带 `loopGuard.maxIterations` 的简单回跳循环、`pause`、`complete`、`fail`、`resume`、`stop`，并在 parser/schema 失败、循环达到上限或用户配置的暂停点等待用户接管。

## 正式 task 级别及定级原因

三星任务。

这是 V0 自动化闭环的核心。风险在于 runner 不能变成不可观测后台 loop，不能替用户理解业务语义，也不能和 parser/Codex session 强耦合。capture adapter 和 parser 实调用留给 `.006/.007`。

## 范围内

* macro run state machine。
* step 执行：`send_line`、`wait`、`sleep`、`input_line`、`capture-source`、`parse`、`branch`、`goto`、带 `loopGuard.maxIterations` 的简单回跳循环、`pause`、`complete`、`fail`、`resume`、`stop`。
* TerminalRef resolution by index/id/alias。
* manual override 和 user prompt requested。
* mock capture source 和 mock parser stub。
* 所有动作写入 `.004` event log。

## 范围外

* 不实现真实 Codex hook adapter。
* 不实现真实 `ai-json` parser。
* 不实现 parser replicas disagreement。
* 不做 Codex session binding。
* 不做系统级 command/file audit。
