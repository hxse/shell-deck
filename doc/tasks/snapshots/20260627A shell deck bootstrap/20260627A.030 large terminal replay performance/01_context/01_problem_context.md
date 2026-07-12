# Problem Context

## 使用场景

用户在 shell-deck 的真实 shell tab 中只读打开 Codex session `019f4000-3890-7172-b9d5-4a6982ed1488`。同一 session 在本地 Konsole 很快出现，在网页 terminal 中却会长时间卡住；历史内容加载完成后，后续对话和滚动都正常。

本任务只用 session 文件的规模校准复现：文件为 37,174,834 bytes、17,268 行，不读取正文，也不把 session id 写进运行时代码。

## 根因

卡顿不是 Codex 恢复逻辑、磁盘持久化或重复 replay。当前 PTY helper 最多按 4096 bytes 读取，真实 burst 又会被 Bun stdout 进一步切成大量小事件。离线实测 `seq 1 1000000` 的 7,889,021 characters 在约 400ms 内产生 20,089 个 `pty_output`。

每个消息随后触发多层累计历史工作：

1. server 对每个小 chunk 单独 JSON serialize 和 WebSocket send；
2. `App.svelte` 每次复制完整 `terminal.replay`；
3. `TerminalSlot.svelte` 每次扫描 prefix、复制 replay，并把完整历史 `join()` 后写入 DOM attribute；
4. 同一个 output effect 还反复测量 layout、resize/scroll。

这条链路对累计 output 呈 O(n²)。只复刻 replay copy/prefix/full join，`4000 × 4096B` 已耗时约 10.55s；去掉 full join 后同规模约 105ms。xterm parser-only 基线接近线性，所以它不是原始 O(n²) 的来源。

消除 O(n²) 后还暴露出两个独立问题。其一，browser frame batcher 会把落后期间的数据无上限 `join()` 成一个巨型 `xterm.write()`；一旦 rAF 落后，下一次 write 更大，形成 parser 阻塞 → rAF 更晚 → payload 更大的正反馈。其二，Bun WebSocket backpressure 不能只靠 batching 回避：`send() === -1` 的当前 frame 已被接受，`send() === 0` 才是 dropped；忽略返回值会静默丢 output。即使加入 pending queue，如果直接在 Bun `drain` callback 内同步续发，第二次打到 `-1` 后也可能不再收到下一次 drain。37,174,834-byte 探针在该错误路径上 5 秒只收到 5,767,168 bytes，queue 仍剩 119 frames；把续发放到下一 macrotask 后可完整、按序送达。

## 方案对比

### Codex 特判

根据进程名或 session id 关闭 replay/渲染，改动看似小，但会把 terminal 底座变成 Codex orchestration，并且其他大输出程序仍然卡顿。本任务拒绝该方案。

### 只删除 DOM attribute

它能移除最重的 full join，却仍保留数万 WebSocket message、Svelte replay copy、prefix scan 和 layout read。它是必要修复，不是完整修复。

### 只做 batching，不处理 WebSocket send 状态

更大的 server batch 能减少消息数，但不能保证 slow client 不进入 backpressure。继续忽略 `send()` 的 `-1` / `0` 区别会在压力下静默丢 frame；在 `drain` callback 内同步打满又会让 pending queue 永久停住。本任务拒绝把“通常够快”当成可靠传输 contract。

### 端到端有界 batching 与增量 renderer

推荐方案在 real PTY edge 合并碎片，在每个 WebSocket connection 上用 byte-bounded pending queue 承接 backpressure，在 browser frame edge 再合并消息，并让 TerminalSlot 只消费 append/replace revision。server replay 按 bytes 保留 tail；每个 logical render update 由 `32Ki × 4` callback pump 顺序喂给 xterm，最多四个 chunk outstanding，且绝不跨 logical update 预发。这样同时降低消息数、消除 O(n²) 历史处理、避免 parser 双峰 cliff，并确保压力下不是靠丢 output 换速度。

## 取舍结论

本任务选择端到端方案。server 参数矩阵把 PTY batch 固定为 4ms / 256KiB 的 latency/event-count Pareto 点。browser standalone 矩阵中，32Ki chunk 的 outstanding window 从 1 增至 4 可减少约 5% 调度开销，继续增至 8/16 没有收益；完整 37MiB 页面 A/B 中，`32Ki × 4` 三轮为 4.8/4.7/4.6 秒，`128Ki × 1` 为 4.8/4.7/5.0 秒，因此选择吞吐不劣且 Long Task 风险更低的 `32Ki × 4`。WebSocket drain 使用 `setImmediate` 进入下一 macrotask，不能改成同步续发或 microtask。所有数据保持原顺序，只有同一 logical update 的全部 xterm callback 完成后才能宣告 parsed。
