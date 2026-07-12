# Review Result

## 总体判断

本轮同时审阅代码和文档。大会话首次加载卡顿不是一个参数过小，而是三段问题叠加：real PTY tiny-output message storm、browser 对累计 replay 的 O(n²) 工作和无上限 parser write，以及 Bun WebSocket backpressure 下的静默 drop / drain 无法 re-arm。最终实现把这三段都收敛为有界、可追踪的主链，并把 server replay 的逻辑 tail 与物理 string storage 一起按 bytes 约束。

37,174,834-byte 真实 PTY fixture 已完整经过页面现有 terminal input、唯一 app WebSocket、Svelte state 和 xterm callback；marker、enqueue/consumed volume、顺序、页面响应性和物理 retention 都有独立 oracle。server、frontend、tests/docs 三路 post-review 未发现剩余 P1/P2，当前 change 可以通过 Close Gate。

## Gate 结论

通过。

* `just check`：通过，Svelte/TypeScript 0 errors / 0 warnings。
* `just build`：通过；JS 583.05 kB（gzip 161.58 kB），CSS 38.12 kB（gzip 7.96 kB）。父 change 已存在的 Vite `>500 kB` single-bundle warning 仍在，按冻结停止线记录，不扩张为本 task 的 code-splitting 重构。
* `LD_LIBRARY_PATH=... just test-030`：51 个 unit/integration tests、383 assertions 全部通过；6 个 Chromium E2E 全部通过。真实 Bun 37MiB multi-drain regression 约 93ms，40,000-byte fake browser burst 约 3.4s，真实 PTY 37MiB 页面主链约 4.3s，reset generation 约 2.0s。
* `just test-unit`：296 tests、1775 assertions 全部通过。
* `git diff --check`：通过。
* production、tests、active specs 与 guides 的 legacy scan：`replayLimit`、`DEFAULT_REPLAY_LIMIT`、`data-rendered-replay`、`renderedReplay`、旧 parser telemetry token 均为 0 命中；server production 不再直接调用 `ws.send()` 绕过 per-client queue。
* 参数 A/B：完整 37MiB 页面三轮中，`32Ki × 4` 为 4.8/4.7/4.6s，`128Ki × 1` 为 4.8/4.7/5.0s；最终选择中位数略优且 Long Task 风险更低的 `32Ki × 4`。

## Findings and Solutions

### P1/L1，已修复：累计 replay 热路径退化为 O(n²)

* 位置：`src/App.svelte`、`src/lib/terminalViewState.ts`、`src/lib/components/TerminalSlot.svelte`。
* 问题：每个 live chunk 都复制/扫描/拼接完整 replay，并在 output effect 内测量 layout；frame 落后时又会形成一个无上限 `xterm.write()`。
* 为什么重要：会随 transcript 累计长度超线性恶化，正好解释“首次历史加载卡很久，完成后后续对话正常”。
* 证据：旧路径 `4000 × 4096B` probe 约 10.55s；删除 full join 后同规模约 105ms。最终 37MiB browser fixture 在 4.3s 完成并保持 frame gap / Long Task 小于 100ms。
* 推荐处理：按 animation frame 合并 state commit，以 append/replace revision 只传当前 delta；xterm 使用 `32Ki × 4` bounded pump，不跨 logical update 预发。
* 修改归属：代码与文档一起改，已完成。
* 是否阻断 Gate：是，已解除。

### P1/L1，已修复：WebSocket backpressure 会丢 frame 或永久停住

* 位置：`server/webSocketSendQueue.ts`、`server/httpServer.ts`。
* 问题：Bun `send() < 0` 表示当前 frame 已 accepted，`0` 才是 dropped；忽略结果会静默丢 output。在 native `drain` callback 内同步续发到第二次 `<0` 又可能无法 re-arm 下一次 drain。
* 为什么重要：此前看似更快的路径实际只收到部分 37MiB，性能数字建立在丢数据上。
* 证据：错误同步探针 5s 只收到 5,767,168 bytes、剩 119 frames；最终真实 Bun regression 经至少两轮 backpressure/drain，37,174,834 bytes 逐 frame exact、无重发、pending 清零，约 93ms。
* 推荐处理：每个 connection 使用 64MiB pending queue；`<0` 不重发，`0`/throw/overflow fail loudly；用 `setImmediate` 在下一 macrotask 继续 drain。
* 修改归属：代码与文档一起改，已完成。
* 是否阻断 Gate：是，已解除。

### P1/L1，已修复：逻辑 replay 有界但物理 stale strings 无界

* 位置：`server/terminalDeckManager.ts`、`tests/unit/terminalReplayByteLimit.test.ts`。
* 问题：旧实现只移动 `replayStart`，要累计 1024 个 discarded chunks 才 slice；256KiB batch 可残留约 256MiB，接近 2MiB 的 chunk 时最坏接近 2GiB。
* 为什么重要：公开 snapshot 虽只有 2MiB，server 仍持有完整大会话，直接抵消本任务的内存目标。
* 证据：新增 `replayDiscardedBytes` 后，37,174,834-byte / 256KiB regression 证明 logical replay ≤2MiB、discarded bytes <2MiB、persistent physical strings ≤4MiB，storage array 不随 burst 线性增长。
* 推荐处理：discarded bytes 达 replay limit 时立即 compact，同时保留 tiny-chunk count/占比条件做 amortized compaction。
* 修改归属：代码与文档一起改，已完成。
* 是否阻断 Gate：是，已解除。

### P2/L1，已修复：generation、flush barrier 与完成 oracle 不完整

* 位置：`server/realPtyBackend.ts`、`server/terminalDeckManager.ts`、`src/lib/terminalParserWritePump.ts`、`tests/e2e/terminalLargeReplay.spec.ts`。
* 问题：close/reset/resize 可能越过 pending output；旧 parser callback 可能在 replace 后回写；完整 marker 曾可先出现在 typed command echo 中，heartbeat 也可能漏掉最后 parser task。
* 为什么重要：这些边界会造成 quietly wrong 的顺序、旧 generation 复活或 false-positive 性能 Gate。
* 证据：现有 close/reset/resize exact-order tests、required `launchId`、stale callback tests、拆分生成 marker、current-generation enqueue/consumed counters，以及 completion 后双 rAF + `PerformanceObserver.takeRecords()` 共同覆盖。
* 推荐处理：所有 state barrier 前同步 flush；replace 递增 parser generation 并清 queue；完成点同时验证 marker 与完整 code-unit volume。
* 修改归属：代码与文档一起改，已完成。
* 是否阻断 Gate：是，已解除。

### P3/L1，已记录：大量小 pending frame 的 `Array.shift()` 成本

* 位置：`server/webSocketSendQueue.ts`。
* 问题：drain 对每个 pending frame 使用 `Array.shift()`，极大量 tiny frames 时可能退化为 O(n²) 数组搬移。
* 为什么重要：64MiB 是 byte cap，不是 frame-count cap；非 PTY 小消息风暴仍可能触发较高 CPU。
* 证据：当前 real PTY 已按约 256KiB batching，37MiB 约 142 frames，真实 Bun regression 约 93ms，未触发该风险。
* 推荐处理：若后续出现 tiny-frame slow-client 场景，再改为 head index/deque 并补 small-frame pressure regression。
* 修改归属：代码与测试一起改；记录为后续 cleanup。
* 是否阻断 Gate：否。

## 需要人工拍板

无。

## AI 可直接修

全部 P1/P2 已在当前 change 内修复并补 regression。P3 queue head-index cleanup 不阻断本任务，未继续扩张。

## 未覆盖与残余风险

* 未读取给定 session 的正文，也未让自动化测试 attach 或修改该 session；只读取 metadata（37,174,834 bytes、17,268 lines）校准 synthetic fixture。真实会话保留为人工 smoke。
* connection-local pending queue 不是 durable spool。自动 reconnect、跨连接完整重放与全局 PTY flow control 按 spec 排除；queue overflow 会关闭慢 client，而不会暂停健康 client 的共享 PTY。
* Text backend 正文不受 shell replay tail 截断；极大 Text 全文更新仍可能有累计字符串成本，不属于本次 PTY hot path。
* 本机 Playwright Chromium 需要显式补入已有 Nix runtime `LD_LIBRARY_PATH` 才能加载 `libatk` 等 shared libraries；带同一环境的正式 recipe 全部通过。这是验证环境约束，不是产品运行失败。
* Vite inherited single-bundle size warning 仍存在，已在 Gate 中显式记录。

## 审阅范围

* server：PTY UTF-8 streaming decode、4ms / 256KiB batching、close/reset/resize flush barriers、逻辑/物理 byte-bounded replay、per-client WebSocket queue、Bun send/drain lifecycle 与 multi-client 隔离。
* protocol/browser：required `launchId`、per-terminal frame batching、bounded remount tail、append/replace revision、`32Ki × 4` parser pump、generation invalidation、bounded parsed telemetry 与 layout hot path。
* regressions：threshold/timer/order/Unicode、physical replay retention、真实 Bun multi-drain exact delivery、37MiB real PTY→browser→xterm volume/marker/响应性、tab remount、reset 与 stale callback。
* 文档：task meta/context/spec/plan、active terminal contract、Quickstart、task index、最终 Gate evidence 与旧痕迹扫描。
* AI post-review：server、frontend、tests/docs 三路复审均完成；最终无剩余 P1/P2，无需人工拍板。
