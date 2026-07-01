# Contract

## 任务边界

本任务只建立和执行 macro GUI smoke 测试矩阵。它允许补测试、补测试 helper、补文档和补轻量 UI 可观测性；若发现产品 P1/P2 缺陷，应回到对应实现文件修复，但不能借本任务新增未设计过的 macro 能力。

范围内：

* 用 Playwright MCP/browser automation 点击 GUI 跑 macro。
* 普通 shell macro smoke。
* shell 内 Codex macro smoke。
* 记录每个 smoke 的步骤、结果、失败截图或 trace。
* 把稳定 smoke 固化成可重复执行的 test recipe。
* 明确 offline/online 分层。

范围外：

* 不做 session binding。
* 不新增 role/orchestration。
* 不把 Codex online smoke 放进默认离线 Gate。
* 不把 API-only 测试作为本任务完成标准。

## 测试入口

本任务应新增或确认以下 just 入口：

* `just test-010-shell-gui`：普通 shell GUI smoke，离线、确定性、必须通过。
* `just test-010-codex-gui`：Codex-in-shell GUI smoke，online，可因 auth/network/model quota blocked。
* `just test-010-offline`：至少包含 `just check`、`just test-unit`、`just test-e2e`、`just test-010-shell-gui`。
* `just test-010`：默认等价于 `just test-010-offline`。

推荐启动模式：

* 普通 shell GUI smoke 使用 `just start-mock-ai` 或测试内等价 server command，允许 mock ai-json parser，但 terminal 必须是 real shell。
* Codex GUI smoke 使用 `just start-codex-ai`，并在页面 terminal 中通过 shell-deck `codex` recipe 启动 Codex：

```bash
just -f <shell-deck-root>/justfile -- codex ...
```

## GUI 操作要求

测试必须通过浏览器页面完成核心动作：

* 点击 terminal tab。
* 在 xterm 中输入 shell command 或 Codex command。
* 点击 macro panel 的 Create/Save/Start/Pause/Resume/Stop。
* 使用 macro panel 表单添加/编辑 step。
* 使用 JSON tab 导入或核验复杂 template。
* 展开节点日志，检查 node log、event JSON、artifact refs。
* 对 `input_line` 弹出的输入框输入文字并回车或提交。

允许通过 HTTP/API 辅助：

* 创建临时 config。
* 读取 run log、artifact、server state 做最终断言。
* 清理测试数据。

但以下动作不能只用 API 替代：

* 启动 macro。
* 暂停/恢复/停止 macro。
* 填写 `input_line`。
* 检查用户可见状态。

## 普通 shell smoke 矩阵

普通 shell smoke 必须覆盖以下 macro 能力：

1. Template CRUD
   * 创建模板、命名、描述。
   * 保存 draft。
   * 删除模板必须二次确认。
   * export/import 备份。
   * Macro tab 与 JSON tab 切换后内容一致。

2. Terminal target
   * 按 index 选择 terminal。
   * 按 terminalId 选择 terminal。
   * 按 alias 选择 terminal。
   * 双击 terminal tab 重命名 alias 后，macro target 自动按最新映射执行。

3. `send_line`
   * 向 real shell 发送 deterministic command，例如 `printf 'SD_SEND_OK\n'`。
   * 不区分 prompt 和 shell command，只验证向目标 terminal 写文本并回车。
   * 单 step 且 `next=null` 时 run 必须完成。

4. `sleep`
   * 覆盖 ms/s/min/h 配置的 schema 与至少一个短 sleep runtime。
   * Pause/Stop 时不能后台继续写完成事件。

5. `wait`
   * `duration`。
   * `terminal-quiet`。
   * `capture-ready-or-user`。
   * `user-continue`。
   * 超时策略至少覆盖 `pause`。

6. `capture-source`
   * `terminal-buffer` raw/normalized artifact。
   * source 配置在 step 内，不使用旧的全局 `captureSources`。
   * UI 能追溯 artifact refs。

7. `parse`
   * `regex` parser。
   * `ai-json` mock parser，只通过显式 mock 入口跑。
   * parser 失败必须 pause，并在节点日志里留下 raw/normalized evidence。

8. Structured branch
   * 不保存字符串表达式。
   * 条件使用 `{ signal, op, value, goto }`。
   * 覆盖 `== true`、`== false`、`is_null`。
   * `value` 类型必须按 parser profile signal type 校验；字符串 `"true"` 不能等价于 boolean `true`。

9. `input_line`
   * 宏暂停并显示类似 Python `input()` 的输入框。
   * 用户在 GUI 输入文字后，macro 把文字发送到指定 terminal 并回车。
   * 提交后 macro 继续。

10. Control flow
    * `pause`、`resume`、`stop`。
    * `complete`、`fail`。
    * `goto` 简单回跳。
    * `loopGuard.maxIterations` 达到上限时 pause/fail 可追溯。

11. `parallel_all`
    * 两个以上 lane。
    * 每个 lane 发送到不同 terminal。
    * lane 复用通用 wait/capture/parse/success condition。
    * 全部 lane 成功后 fan-in 完成。
    * 不支持同 config 多 live run 的行为保持不变。

12. Run log / observability
    * 每个节点默认折叠。
    * 展开节点后能看到该节点做了什么、输入了什么、等待了什么、capture 了什么、parser 输出了什么、branch 走了哪里。
    * 人类 UI 和 AI 追溯读取同一份 event log，不存在两份真值。

## Codex-in-shell smoke 矩阵

Codex smoke 在普通 shell terminal 内启动 Codex，不强绑定 session，不注入 role。测试目标是确认 macro 可以编排“用户自己运行的 Codex TUI/exec 路径”。

必须覆盖：

1. 在 shell terminal 中通过 shell-deck `codex` just recipe 启动 hook-enabled Codex。
2. hook 返回并上报 `terminalId`、`configId`、`launchId`、`codexSessionId`。
3. macro 通过 `send_line` 向运行 Codex 的 terminal 发送普通自然语言指令。
4. macro 使用用户选择的 capture source：
   * `terminal-buffer`：从 TUI 屏幕/scrollback 截取。
   * `agent-event`：等待 Codex Stop hook 返回 `last_assistant_message`。
5. `regex` 或 `ai-json` parser 能解析 capture artifact。
6. structured branch 能根据 parser signal 进入 pause/input_line/send_line/complete。
7. 展开 run log 能看到 terminalId/configId/launchId/codexSessionId 和 artifact refs。

Online blocked 规则：

* 如果 Codex CLI 未安装、未登录、网络不可用、模型 quota 不足，`just test-010-codex-gui` 可以 blocked。
* blocked 必须写入 `04_review/**`，包括具体阻断点和已完成的前置检查。
* blocked 不能让 `just test-010-offline` 失败。

## Gate 规则

Close Gate 必须满足：

* `just check` 通过。
* `just test-unit` 通过。
* `just test-e2e` 通过。
* `just test-010-shell-gui` 通过。
* 普通 shell smoke 的失败截图/trace/run log 已保存或可重现。
* Codex smoke 已通过，或以 online blocked 形式记录清楚。
* `04_review/01_result.md` 有 P1/P2/P3 review。
* `04_review/02_verification.md` 有实际命令、GUI smoke 结果、blocked reason。
