# Execution Plan

## Phase 1: Test harness boundary

目标：建立 GUI smoke 入口，不让 API-only 测试冒充用户路径。

工作项：

* 新增 `just test-010-shell-gui`。
* 新增 `just test-010-codex-gui`。
* 新增 `just test-010-offline` / `just test-010`。
* 明确测试数据目录、端口、trace/video/screenshot 输出目录。
* 确认测试 server 使用 real shell terminals；mock ai-json 只能通过显式 mock 入口启用。

停止线：

* 如果测试只能调用 API，不能进入下一阶段。
* 如果 GUI 无法稳定启动或关闭 server，先修启动/停止路径。

## Phase 2: Ordinary shell macro GUI smoke

目标：普通 shell 路径把 macro 全功能矩阵跑通。

建议拆分测试：

* `macro-shell-basic.spec.ts`
  * terminal tab。
  * template create/save/delete confirm。
  * `send_line`。
  * single-step `next=null` complete。

* `macro-shell-flow.spec.ts`
  * `sleep`。
  * `wait`。
  * `pause/resume/stop`。
  * `input_line`。
  * `goto` + loop guard。

* `macro-shell-capture-parse.spec.ts`
  * terminal-buffer capture。
  * regex parser。
  * mock ai-json parser。
  * structured branch。
  * parser failure pause。

* `macro-shell-parallel.spec.ts`
  * `parallel_all` two or more lanes。
  * lane success conditions。
  * node log expansion。

停止线：

* 任何 P1/P2 产品行为失败，回到对应实现修复。
* 测试不能通过“直接写 run log”绕过 GUI。

## Phase 3: Codex-in-shell GUI smoke

目标：在真实 shell terminal 中启动 hook-enabled Codex，然后用 macro 编排 Codex。

建议流程：

1. 启动 `just start-codex-ai`。
2. 打开页面。
3. 在 terminal 中运行：

```bash
just -f <shell-deck-root>/justfile -- codex ...
```

4. 用 macro 向该 terminal 发送一个小任务。
5. 分别测试 `terminal-buffer` capture 和 `agent-event` capture。
6. parser 后按 structured branch 进入 `input_line` 或 `complete`。
7. 展开节点日志确认 Codex event 和 artifact refs。

停止线：

* Codex/auth/network/model quota 不可用时，记录 blocked，不阻塞 offline Gate。
* 如果 hook 上报成功但 UI 无法关联 terminalId/configId，这是 P2，需要修。

## Phase 4: Review and documentation

目标：把 GUI smoke 的真实结果写入 review。

必须产出：

* `04_review/01_result.md`
  * P1/P2/P3 findings。
  * AI 直接修 / 需要用户拍板 / online blocked。

* `04_review/02_verification.md`
  * 实际执行命令。
  * GUI smoke 覆盖矩阵。
  * 普通 shell pass/fail。
  * Codex-in-shell pass/fail/blocked。
  * trace/screenshot/log 路径。

## Close Gate

按顺序执行：

```bash
just check
just test-unit
just test-e2e
just test-010-shell-gui
just test-010-offline
```

可选 online：

```bash
just test-010-codex-gui
```

`just test-010-codex-gui` 只有在真实 Codex 环境可用时要求 pass；否则必须记录 blocked reason。
