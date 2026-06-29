# Execution Plan

## 模块边界

`.002` 是第一个真正实现产品骨架的任务，必须先稳定项目命令入口和 terminal API，再写 UI。建议模块边界：

```text
package.json
justfile
vite.config.ts
playwright.config.ts
src/lib/protocol.ts
src/lib/terminalIdentity.ts
src/lib/configScope.ts
src/lib/terminalDeckClient.ts
src/lib/components/TerminalDeck.svelte
src/lib/components/TerminalSlot.svelte
server/httpServer.ts
server/configStore.ts
server/terminalDeckManager.ts
server/fakeTerminalBackend.ts
server/realPtyBackend.ts
server/ptyHelper.*
tests/unit/terminalDeckManager.test.ts
tests/unit/realPtyBackend.test.ts
tests/unit/httpServer.test.ts
tests/e2e/terminalDeck.spec.ts
```

`.001` 的 `src/probe001/**` 只能作为 API probe 参考，不能成为正式 runtime 模块。正式模块要使用 `configId + terminalId`，不能引入 role 维度。

## 阶段

1. 补齐项目脚手架和统一命令入口。
   * `just check`
   * `just build`
   * `just test-unit`
   * `just test-e2e`
   * `just test-002`
   * `just test` 按顺序组合 unit/e2e
2. 定义正式 protocol：config snapshot、terminal snapshot、terminal index map、`pty_output`、`terminal_input`、`terminal_resize`、terminal lifecycle、replay、reset。
3. 实现 `terminalIdentity`：使用 `short-uuid` 生成 `term_<shortUuid>`；维护 config-scoped `terminalIndex -> terminalId` map。
4. 实现 fake terminal backend 和 `TerminalDeckManager`，覆盖 fan-out、late replay、默认无锁输入、reset transaction、config isolation。
5. 实现 real PTY backend 和 helper stdin pipe 控制通道。保留 command-file 只能作为兼容/diagnostic，不得作为主输入路径。
6. 实现 local-only HTTP/WebSocket server，默认绑定 `127.0.0.1`，并把 config scope 绑定到 URL/API。
7. 实现 Svelte terminal deck UI：内部 terminal tabs、xterm.js 渲染、tab 拖动 reorder、双击 alias rename、index/id/alias 显示、multi-tab sync；协议保留 resize/replay，但 V0 UI 不暴露固定比例和 Replay 调试按钮。
8. 补 unit、integration、Playwright e2e 和 quickstart，删除或隔离 `.001` probe harness 对正式 runtime 的依赖。

## 验证命令

Close Gate 只接受 just 入口：

```bash
just check
just build
just test-unit
just test-e2e
just test-002
```

`bun run ...` 只能作为 just recipe 内部实现，不能写成外部 Gate 命令。

## Legacy Kill List

本任务不得引入：

* role、role_call、validator-call、safeToSend、canSendNext。
* Codex launcher、Codex role backend、Codex session binding。
* sealed instruction、caller proof、blocking role operation API。
* 前端 local echo 作为默认显示路径。
* command-file polling 作为 real PTY 主输入路径。

## 阶段停止线

进入 `.003` 前必须满足：

* `.001` probe 中 A/T API 结论已经映射为正式 protocol 或明确弃用。
* 两个浏览器 tab 连接同一 `configId + terminalId` 时共享 replay 和实时 output。
* 不同 config 下相同 terminal index 不能互相解析。
* reset 失败保留旧 PTY、旧 replay 和已有订阅。
* real PTY 输入、Ctrl-C、resize、exit 和长 paste 有自动测试或明确 smoke 记录。
* UI 不暴露 role 概念。

## Close Gate

* `just check`、`just build`、`just test-unit`、`just test-e2e`、`just test-002` 通过。
* 两个浏览器 tab 同步 terminal 输出，late tab 能收到 replay。
* real PTY 输入路径确认不依赖 command-file polling。
* terminalId 由 `short-uuid` 生成，terminal tab reorder 后 terminalId 不变，index/id/alias map 同步。
* 人工 smoke 覆盖浏览器 terminal tab 输入、长 paste、Ctrl-C、tab reorder、alias rename、multi-tab replay，并写入 `04_review/**`。
* `git diff --check` 通过。
