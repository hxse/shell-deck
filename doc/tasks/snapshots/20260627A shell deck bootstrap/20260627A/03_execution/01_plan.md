# Execution Plan

## Gate 状态

当前是 V0 蓝图 task。`00_meta.md`、`01_context`、`02_spec` 通过人工文档 Gate 后，进入九个子任务的实现与 Close Gate。

## 阶段顺序

1. `20260627A.001 v0 api probe`
   * 验证 `codex` just recipe、临时 hook 注入、terminal id env metadata、必填 Codex session id 上报和 `AgentEvent Ingest`。
   * 验证 terminal deck API baseline：WebSocket snapshot/fan-out/replay、config isolation、input/resize、helper stdin pipe、reset transaction 和 terminal-buffer capture。
   * 该任务决定 `.002`/`.006` 的底层 API 是否稳定。

2. `20260627A.002 terminal deck foundation`
   * 交付可运行项目和可靠 terminal deck。
   * 必须保留 Real PTY stdin pipe input latency stabilization。
   * 必须实现 config-scoped `terminalIndex -> terminalId` 实时映射。

3. `20260627A.003 macro template workbench`
   * 交付宏模板可视化管理。
   * 模板可缓存、可导入、可导出，terminal ref 支持动态 index 和稳定 id，但不执行宏。

4. `20260627A.004 run log and artifacts`
   * 交付 append-only event log、artifacts、derived state rebuild 和节点日志视图。
   * 先保证可观测真值，再实现 runner。

5. `20260627A.005 macro runner state machine`
   * 交付 `send_line`、`wait`、`sleep`、`input_line`、`capture-source`、`parse` stub、`branch`、`goto`、带 `loopGuard.maxIterations` 的简单回跳循环、`pause/complete/fail/resume/stop` 的最小状态机。完整 `for_each`、item binding、嵌套循环、`break` 和 `continue` 留给 V1。
   * 只接 mock capture/parser stub，不接真实 `ai-json` 模型调用。

6. `20260627A.006 capture source and agent event adapters`
   * 交付默认 `terminal-buffer` capture。
   * 交付 `AgentEvent Ingest`、Codex Stop hook adapter 和 JSONL spool fallback。

7. `20260627A.007 parser profiles and adapters`
   * 交付 parser adapter、`regex` parser、`ai-json`/codex exec one-shot probe、内置 parser profiles、schema、normalize、replicas 和 fixture eval。
   * parser 只产生 soft signals，不做系统事实审计。

8. `20260627A.008 bounded parallel lanes`
   * 交付单个 run 内的受限 `parallel_all`：静态 lanes、不同 terminal、通用 capture/parser/condition、all-success join 和可恢复 per-lane 日志。

9. `20260627A.009 v0 closeout`
   * 交付 quickstart、active specs 同步、e2e 验收、review 报告和 V0 known limitations。

## Legacy Kill List

后续所有子任务都不能把以下旧语义作为主线迁移进来：

* `RoleId`、`roles[]`、`orchestrator` / `coder` / `reviewer` / `validator` 作为核心对象。
* `role_call`、`validator-call`、`role_state`、`safeToSend`。
* sealed instruction registry。
* caller proof / dispatch guard。
* Codex launcher / Codex role backend。
* Codex hook wait/collect lifecycle 作为后台 loop。
* blocking role operation API。
* `.orch-web` snapshot layout。

## 收口要求

九个子任务完成后，`shell-deck` V0 应该可以用一句话验收：用户打开本地浏览器 terminal deck，在同一 config 下按动态序号、稳定 terminal id 或 alias 操作多个 terminal，用 shell-deck `justfile` 的 `codex` recipe 捕获 Codex agent 输出，用可视化宏模板编排 send-line、sleep、input-line、等待、capture、regex/ai-json 解析、结构化分支、受限 parallel_all 和基础流程控制，并且所有运行过程都能从同一份 event log 恢复和追溯；不同 config 之间互相隔离。
