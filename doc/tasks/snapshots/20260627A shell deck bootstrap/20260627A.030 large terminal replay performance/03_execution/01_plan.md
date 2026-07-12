# Execution Plan

## 阶段 1：基线与 contract

* 用给定 session 的文件大小校准 synthetic fixture，不读取会话正文。
* 固定 real PTY message storm、browser O(n²) 和非根因排除证据。
* 完成 task 文档与 AI pre-review。

进入下一阶段条件：根因可由源码与 deterministic probe 共同解释，spec 冻结 batching、retention、render revision 和停止线。

## 阶段 2：server output pipeline

* 新增职责单一的 PTY output batcher，支持 injectable scheduler。
* real PTY 使用 UTF-8 safe streaming decode，并在 exit 前 flush。
* server replay 从 chunk-count 换成 byte-bounded tail。
* 增加 per-client 64MiB pending queue，区分 Bun send 的 accepted/backpressured/dropped 结果，并在下一 macrotask re-arm drain。
* 补 batch order、threshold、timer、Unicode、exit flush 和 replay byte bound unit/integration tests。

进入下一阶段条件：20,000 tiny chunks 的 exact output 与 batch-count oracle 通过；旧 `replayLimit` 在源码与测试中清零。

## 阶段 3：browser output pipeline

* 提取 browser `pty_output` frame batcher。
* 引入 `TerminalViewSnapshot` 和 append/replace revision。
* TerminalSlot 删除 replay prefix scan、全文 DOM join 和 output-driven fit。
* 用 generation-aware `32Ki × 4` callback pump 顺序驱动 xterm，并在 logical update 全部 callback 完成后更新 bounded parsed tail/revision。
* 分别记录 browser enqueued 与 xterm callback-consumed code units，建立不会被 command echo 提前命中的完成 oracle。
* 更新现有 E2E oracle，并增加 large burst E2E。

进入下一阶段条件：large burst sentinel、bounded work、tab switch/late replay/reset/multi-client 正确性通过。

## 阶段 4：Close Gate

* 串行运行 `just check`、`just build`、`just test-030`、`just test-unit`。
* 执行 diff review、旧痕迹扫描和 AI post-review；修完全部 P1/P2。
* 同步 `terminal_deck_contract.md`、必要 quickstart、task index 和 `04_review`。

## 文件影响

预计修改：

* `server/realPtyBackend.ts`
* `server/terminalDeckManager.ts`
* 新增 server output/replay helper
* `src/lib/terminalDeckClient.ts`
* `src/App.svelte`
* `src/lib/components/TerminalSlot.svelte`
* `src/lib/components/workspace/WorkspaceShell.svelte`
* 新增 browser batching/view-state/parser-pump helper
* terminal manager、real PTY、WebSocket queue/真实 Bun backpressure 与 Playwright tests
* `justfile`、`package.json`
* 当前 task、active spec、guide 与 index

## Legacy Kill List

* `TerminalDeckManager.replayLimit`
* `DEFAULT_REPLAY_LIMIT` chunk-count retention
* browser live replay 的无限 `[...terminal.replay, data]`
* TerminalSlot 的 full-prefix `some`、full replay clone 和 per-output `fitToHost`
* `data-rendered-replay` 全文 DOM/test oracle
* 仍引用旧 attribute 或旧 manager option 的 tests/debug/docs

## 验证与停止线

`just debug-030-large-replay --repeat-each=3` 只用于离线参数 A/B，会重复运行 37MiB real PTY browser fixture；它不是 Close Gate 的替代入口。正式 Gate 仍是 spec 中的 `just check`、`just build`、`just test-030`、`just test-unit` 和 `git diff --check`。

P1/P2、本任务新增 warning、旧痕迹或核心 Gate failure 阻断交付。父 change 已存在且本任务未放大的 Vite single-bundle size warning 必须在 review 如实记录，但不扩张为本任务内的 code-splitting 重构。slow-client reconnect/durable spool、跨连接完整重放、全局 PTY flow control、历史分页、binary protocol、WebGL renderer 和真实 Codex automated smoke 明确不进入本轮；若 synthetic fixture 与用户症状仍不一致，只记录未覆盖并提供人工 smoke，不继续无限扩张协议。
