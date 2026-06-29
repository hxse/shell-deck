# 20260627A.008 Bounded Parallel Lanes

## 任务概括

交付 V0 唯一有限并发能力：在单个 macro run 内执行 `parallel_all` fan-out/fan-in 节点，把同一批通用 capture/parser 校验流程并发跑在不同 terminal 上，全部 lane 成功后再继续。

## 正式 task 级别及定级原因

三星任务。

本任务跨 macro template schema、runner state machine、run event log、capture source、parser adapter 和 UI 节点日志。它不放开多个 macro run 并发，但会引入单个 run 内的受限并发恢复语义，风险高于普通 UI/文档收口。

## 范围内

* `parallel_all` template step schema。
* lane 级 terminal ref preflight 和不同 terminal 约束。
* lane 内复用 `send_line`、`sleep`、`wait`、`capture-source`、`parse` 的线性步骤。
* lane success condition 结构化校验。
* all-success join、pause/fail 语义和 resume 去重。
* UI 的并发节点编辑和 per-lane 展开日志。
* offline e2e：terminal-buffer + regex、terminal-buffer + mock ai-json、AgentEvent + mock ai-json。

## 范围外

* 不允许同一 config 启动多个 live macro run。
* 不实现 general-purpose scheduler 或 terminal-level lock。
* 不允许 lane 共享自动发送目标 terminal。
* 不允许嵌套 `parallel_all`。
* 不允许 lane 内 `input_line`、`branch`、`goto`、回跳循环、`for_each`、`break`、`continue`、`pause`、`complete`、`fail`、`stop`。
* 不新增第三种 capture source 或 parser kind。
