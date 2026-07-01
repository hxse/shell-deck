# Problem Context

## 背景

`.009` 已把 V0 功能和文档收束起来，但当前主要验证仍偏向 unit/integration/API-level/e2e 组合。用户实际使用 macro 时，不是直接调用 HTTP API，而是在浏览器里：

1. 打开 shell-deck。
2. 在 terminal tab 中运行普通 shell 或 Codex。
3. 在 macro 面板里创建、编辑、启动、暂停、恢复、停止模板。
4. 展开节点日志查看每一步做了什么。

因此还需要一个专门任务，用真实 GUI 点击验证 macro 功能是不是从用户路径上可用。

## 核心风险

### GUI 和 API 行为漂移

宏 runner/API 已经有自动化覆盖，但 GUI 可能出现：

* draft 未保存就 Start，runner 读到旧模板。
* 按钮状态不可用或没有反馈。
* JSON/import/export 和表单状态不同步。
* terminal tab alias/index/id 映射在 UI 上和 runner 不一致。
* run log 节点可追溯性存在，但人类看不到关键 evidence。

这些问题只靠 API 测试不容易暴露。

### 普通 shell 和 Codex 路径不是同一类验收

普通 shell 路径可以完全本地、确定性地验证 macro 基础能力，例如 `send_line`、`sleep`、`wait`、`capture-source`、`regex` parser、`branch`、`input_line`、`parallel_all`。

Codex-in-shell 路径需要真实 Codex CLI/auth/network/model quota，也涉及 hook/AgentEvent/codexSessionId。它必须单独作为 online smoke，不应混入默认离线 Gate。

### AI 必须真的点击 GUI

本任务的主验收不是“写一个 API 测试证明 runner 能跑”，而是 AI 通过 Playwright MCP 或 Playwright browser automation 直接操作页面按钮、终端、tab、macro 面板和日志展开控件。API 可以辅助准备和断言，但不能替代 GUI 操作。

## 设计原则

* 先测普通 shell，再测 Codex-in-shell。
* 先用 deterministic shell commands 收敛基础行为，再进入真实 Codex online smoke。
* 每个 macro 功能至少有一个 GUI 路径覆盖。
* 所有失败都要能定位到页面状态、run event log、terminal output 或 artifact。
* 不把在线不可用误判为产品失败；online blocked 必须写清原因。
