# Review Result

状态：mcp-gui-smoke-expanded。

本轮继续用 Playwright MCP 和 Playwright 自动化扩展 .010 GUI smoke。普通 shell GUI 覆盖已经从单条 happy path 扩展到 target/index/id/alias、tab rename/reorder、wait、input_line、regex、mock ai-json、parser failure pause、structured branch、control flow、parallel_all、真实 macro run log 展开、sleep 单位和 JSON tab 等主能力。Codex GUI 入口也从“占位 blocked wrapper”改成 online-only 的真实 Playwright harness。

## Gate 结论

shell GUI 离线路径通过：`just test-010-shell-gui` 当前分两段执行，mock 段 12 个 Playwright 用例全绿，disabled parser failure 段 1 个 Playwright 用例全绿。

Codex 路径分两层记录：

* manual MCP Codex smoke: pass。已在浏览器 real shell terminal 内运行 shell-deck wrapped Codex，验证 terminal-buffer capture 和 AgentEvent hook capture。
* automated `just test-010-codex-gui`: online-only harness 已落地。默认离线执行会明确 blocked；设置 `SHELL_DECK_RUN_ONLINE=1` 且有 Codex/auth/network/model quota 时才运行真实 Codex GUI Playwright spec。

## Findings and Solutions

### P2 / AI 直接修：主动 pause step 后 Resume 不会进入 next step（已修复）

现象：模板 `pause_1 -> complete_1` 从 GUI Start 后进入 `paused step: pause_1`，点击 Resume 后仍停在 `pause_1`，没有执行 `next=complete_1`。

处理：runner resume 时如果当前 step 是 `pause` 且 pause step 声明了 `next`，现在会 complete pause step、写入 `control_transition`，并从 next step 继续。已补 integration 回归并用 MCP 复测。

### P2 / AI 直接修：长耗时 macro 完成后 GUI 顶部状态保持 running，必须手动 Refresh（已修复）

现象：`parallel_all` 两个 lane 都成功，API/run log 已 completed，但 macro panel 顶部仍显示 `running`，点击 Refresh 后才变成 completed。

处理：前端 live runner 轮询从短暂 6 次扩展为约 2 分钟，并在非 live 状态停止。已补 delayed macro e2e，并用 MCP 复测无需手动 Refresh。

### P2 / AI 直接修：`just test-010-codex-gui` 不是实际 Codex GUI 测试（已修复）

现象：旧入口只打印 “automated harness is not implemented yet” 后 0 退出，不能证明 Codex-in-shell GUI 路径。

处理：新增 `tests/e2e/codexGuiOnline.spec.ts`，入口在 `SHELL_DECK_RUN_ONLINE=1` 时先从 GUI 启动一个 macro，由 `send_line` 把 wrapped Codex exec command 和 prompt 写入 real shell terminal；等待 Codex 输出与 hook 后，再从 GUI 启动 terminal-buffer 和 AgentEvent 两条 capture/parse/branch macro。离线默认仍 blocked，不进入默认 Gate。

### P2 / AI 直接修：普通 shell GUI smoke 覆盖矩阵不够完整（已修复）

处理：新增 real shell matrix e2e，并扩展 `just test-010-shell-gui`。当前覆盖：

* terminal target: index/id/alias，且 alias rename + tab reorder 后仍正确。
* wait: duration、user-continue、terminal-quiet、capture-ready timeout pause。
* parser: regex 与显式 mock ai-json。
* branch: `== true`、`== false`、`is_null`。
* control flow: pause/resume、goto loop guard、fail、stop。
* `input_line`: GUI 输入后发送到 real shell 并继续。
* `parallel_all`: 两个 real shell lane fan-out/fan-in。
* parser failure: disabled ai-json 从 GUI 启动后 pause，Run Log 节点能展开看到 capture raw/normalized artifact 和 pause evidence。
* actual run log: real shell macro 完成后展开真实 run 的 send/wait/capture/parser/branch 节点，检查 event 和 artifact refs。
* sleep units: UI 覆盖 ms/s/min/h 转换。

### P2 / AI 直接修：连续空回车后 real shell 光标掉出可视区（已修复）

现象：在 real shell terminal 中连续按 Enter，xterm cursor 会下移到可视区外；此时按一次 Ctrl-C，`^C` 实际写入了 replay，但视觉上仍被隐藏在底部不可见区域。

原因：TerminalSlot 之前用硬编码 `16.8px` 行高估算 rows，但浏览器中 xterm 实际 cell height 为 `20px`。rows 被算多后，xterm screen 高于 viewport，底部几行被裁掉。

处理：TerminalSlot resize 改为基于 xterm DOM 实测 cell width/height 计算 cols/rows，并在 replay/resize 后 scroll 到 bottom。已补 `terminalDeck.ui.spec.ts` 回归：连续 90 次 Enter 后 cursor 必须仍在 xterm 可视区内，Ctrl-C 后也保持可见。

### P3 / AI 直接修：run input 的 accessible name 存在测试定位歧义

现象：Playwright `getByRole(button, name=Send)` 同时匹配 input 提交按钮和 `send_line` step 按钮。`data-testid=macro-run-input-submit` 可以精确定位。

建议：保留 test id；若要改善无障碍语义，可把 input submit 的 label 改成更明确的 `Send input`。

### P3 / AI 直接修：JSON tab 目前是 preview，不是可编辑 JSON editor

现象：JSON tab 能查看和 Save/Export，但没有 textarea/contenteditable。复杂模板 smoke 通过 Import/API 预置后再从 GUI 启动。

建议：V0 若希望用户直接编辑 JSON，需要补 JSON editor；否则文档/UI 文案应明确这是 JSON preview。

## 已通过路径

* 默认 `start-mock-ai --seed-backend real`：初始 terminal 是 real/running。
* GUI 新建模板 + `send_line`：不手动 Save，直接 Start，terminal 输出 marker，run completed。
* 串行 shell flow：`send_line -> sleep -> terminal-quiet wait -> terminal-buffer capture -> regex parse -> structured branch -> complete` 通过。
* `input_line`：进入 `waiting_user_input`，GUI 输入 shell command 后发送到 terminal 并 complete。
* wait timeout：等待不存在的新 AgentEvent 后按 `onTimeout=pause` 暂停，随后 GUI Stop。
* target matrix：rename alias + reorder terminal tab 后，index/id/alias 三种 target 都打到正确 real shell。
* parser/branch matrix：regex 覆盖 true/false/null；mock ai-json 通过显式 mock parser 入口。
* control flow：pause/resume、goto loop guard、fail、stop 均可从 GUI 触发并可追溯。
* `parallel_all`：两个 real shell lane 各自 send/wait/capture/parse/success，全部成功后 join completed。
* run log / JSON tab：demo run log 和实际 macro run log 都可展开，节点日志、artifact refs、AI trace 和 JSON preview 可见。
* Codex-in-shell manual MCP：terminal-buffer capture 与 AgentEvent hook capture 均通过，run log 有 `codexSessionId`、`launchId`、artifact refs。
