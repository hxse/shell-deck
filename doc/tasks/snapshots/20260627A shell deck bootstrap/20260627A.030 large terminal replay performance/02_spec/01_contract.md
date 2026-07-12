# Contract

## 任务边界

本任务优化的是“大量 PTY output 在短时间到达 active browser terminal”的主链，同时保证 refresh/late client 只加载一个有界 replay tail。它不改变 terminal input、macro language、Codex hook 或 AgentEvent contract。

阻断交付的条件：

* 任一层仍按每个 live chunk 对完整累计 replay 做 copy、scan 或 join；
* batch 改变字符/控制序列顺序，或 reset/replace 后混入旧 generation output；
* WebSocket backpressure 下静默丢 frame、重发已经 accepted 的 frame，或 pending queue 永久停在未 re-arm 的 drain；
* shell replay retention 仍由 chunk count 决定，导致 batch size 改变可保留字节量；
* E2E 仍用“已 enqueue 的全文 DOM attribute”冒充“xterm 已 parsed”；
* focused correctness/performance oracle、`just check`、`just build` 或全量 unit regression 未通过。

以下不是阻断项：不同机器上的绝对 wall-clock 差异、真实 Codex online smoke 未自动运行、异常慢/失联 WebSocket client 的自动 reconnect、durable spool 与跨连接完整重放。它们只能作为诊断或残余风险记录。

### Breaking cleanup

`TerminalDeckManager` 的内部 `replayLimit` chunk-count option 退出，唯一正式 option 改为 `replayByteLimit`。`TerminalSnapshot.launchId` 成为 required generation field，缺字段的旧 snapshot shape 不再是合法 current protocol。不保留 alias、双读或 fallback。测试中的全文 `data-rendered-replay` oracle 退出，唯一 browser oracle 改为 bounded parsed tail/revision。

## 任务规范

### Real PTY output coalescing

real PTY stdout 必须先经过 UTF-8 安全 decoder，再进入 output batcher。batcher 保持输入顺序，并满足：

* 默认最大等待窗口：4ms；
* 默认目标 batch 上限：256KiB；达到上限立即 flush；
* terminal exit/state 之前先 flush pending output；
* close/dispose 不得静默遗失已经从 PTY 读到的数据；
* 普通 prompt 的额外延迟不得超过一个 batch window。

大小上限是 flush threshold，不允许为了严格切包而切断 Unicode code point 或 ANSI/CSI sequence；控制序列跨 batch 是合法的，xterm 必须按原顺序接收。

### Server replay ownership and retention

server 继续是 terminal replay truth。shell/fake output replay 使用 whole-chunk byte-bounded tail：默认最多 2MiB UTF-8 bytes。追加后从最旧 chunk 开始移除；单个 chunk 超过上限时保留 UTF-8 合法尾部。text backend 的用户正文不按 shell tail 截断。

逻辑淘汰不能只移动 array start index 后无限保留 stale strings。被淘汰但尚未 slice 的 physical discarded bytes 必须小于 replay byte limit；达到上限时立即 compact。默认配置下，一次 append 完成后的 shell replay physical string storage 必须小于 4MiB（最多 2MiB logical tail 加不足 2MiB discarded tail）。tiny-chunk 场景可以同时使用 discarded-count/占比阈值做 amortized compaction，但不得放宽 byte bound。

`replayByteLimit` 必须是正整数；非法值在 `TerminalDeckManager` 构造阶段以 `invalid_replay_byte_limit` fail loudly。

`TerminalSnapshot.replay` 与 `terminal_replay` protocol shape 保持 `string[]`，但内容必须满足当前 byte bound。macro terminal-buffer capture 仍读取 server-owned replay；browser 的 render tail 不参与 capture。

`TerminalSnapshot.launchId` 是 required PTY generation identity：同一 terminal reset 后保留 `terminalId`、生成新的 `launchId`。browser 不得只根据 backend 或 replay 内容猜 generation；`launchId` 变化必须建立 replace revision 并重建 xterm parser，即使 reset 前后 replay 文本完全相同。

### Browser message batching

`TerminalDeckClient` 必须按 terminal 聚合连续 `pty_output`，每个 animation frame 至多向 Svelte 主状态提交一次 append。遇到非-output message 时先 flush 先前 output，保持 output → state/reset 的 wire order；close/dispose 时取消 scheduler 且不得在旧 client 上继续回调。

同一 terminal 内字符顺序必须完全一致。不同 terminal 可以在同一 frame 分别形成一个 batch，因为它们没有共享 terminal parser state。frame batch 是 Svelte state commit 边界，不是无上限 xterm write contract；某一 frame 即使聚合了大 payload，后续 parser pump 仍必须有界。

### Browser terminal view state

browser 使用独立的 `TerminalViewSnapshot` 承载 protocol metadata 与 render update：

```ts
type TerminalRenderUpdate = {
  revision: number
  kind: 'append' | 'replace'
  data: string
}

type TerminalViewSnapshot = TerminalSnapshot & {
  renderUpdate: TerminalRenderUpdate
}
```

`append` 只把本批 `data` 交给已挂载 xterm，不扫描旧 prefix。`replace` 用于真实 snapshot/reset/replay replacement；它必须建立新 parser generation，旧 xterm queued write 不得在 replacement 后生效。普通 metadata 更新只有在 `launchId`、backend 与 replay 内容均未改变时才保留当前 revision。

browser 为 tab remount 保存 bounded replay tail，默认最多 2MiB UTF-16 code units。active xterm 仍消费全部 live output；tail 截断只影响 tab 卸载后再次挂载时可见的旧 scrollback，不得截断当前 live parser stream。

### xterm write and layout

初始/replace replay 与 live append 都先作为 logical render update 进入 generation-aware parser pump。pump 默认按最多 32Ki UTF-16 code units 切片，不得切断 surrogate pair；ANSI/CSI sequence 可以跨片，并由 xterm streaming parser 按原序恢复。同一 logical update 最多允许四个 `xterm.write` outstanding；只有该 update 已发出的全部 callback 完成后，才允许开始下一个 logical update。

只有 logical update 最后一片的 write callback 才表示该 revision 已由 parser 完整处理。replace、unmount 或 launch generation 变化必须清空旧 queue 并使旧 callback 失效。完成 callback 后允许 scrollToBottom，并更新：

* `data-rendered-tail`：最多 8192 UTF-16 code units；
* `data-rendered-revision`：最后完成 callback 的 render revision；
* `data-terminal-enqueued-code-units`：当前 parser generation 已进入 pump 的 code units；
* `data-terminal-parser-consumed-code-units`：当前 parser generation 已由 xterm callback 确认完成的 code units；
* 有界的 write/fit counter，供结构化 E2E oracle 使用。

replace/recreate 必须把两项 code-unit telemetry 一起归零，不能让已主动取消的旧 generation 数据伪装成当前 backlog。telemetry 只保存数字与 bounded tail，禁止把完整 transcript 写入 DOM。

禁止把完整 transcript 写入 DOM。`fitToHost()` 只由 mount、terminal recreation 和 `ResizeObserver` 驱动；output append 本身不得触发 layout measurement。

### WebSocket backpressure boundary

每个 browser connection 使用独立、connection-local 的 `WebSocketSendQueue`。默认 pending byte limit 为 64MiB，按 serialized text frame 的 UTF-8 bytes 计数。Bun `ws.send()` 的结果必须精确解释：

* `> 0`：当前 frame 已发送；
* `< 0`：当前 frame 已被 Bun enqueue 且发生 backpressure，不得重发；此后的 frame 进入本 connection 的 pending queue；
* `0` 或 throw：当前 frame 未可靠接受，必须以 `websocket_send_dropped` / `websocket_send_failed` fail loudly 并关闭该 client；
* pending bytes 超过 64MiB：以 `websocket_send_queue_overflow` fail loudly 并关闭该 client，不得静默删头或丢尾。

Bun 发出 drain notification 后，queue 必须 coalesce 重复 notification，并通过 `setImmediate` 在下一 macrotask 才继续发送。禁止在 native drain callback 内同步续发，也禁止改成 `queueMicrotask` / Promise；这两种写法都可能在再次返回 `-1` 后无法 re-arm 后续 drain。accepted frame 只从 queue 移除一次，所有后续 frame 保持 exact FIFO。

该 queue 只保证当前 connection 生命周期内的有界顺序交付，不是 durable spool。一个慢 client 不得暂停共享 PTY 或拖慢其他 client；自动 reconnect、跨连接完整重放和全局 PTY flow control 不属于本任务。

## 示例

### 大量 active output

```text
PTY raw callbacks:       20,089 tiny chunks
server output batches:  ordered, <=4ms window, ~256KiB threshold
browser state commits:  <= one append per terminal per animation frame
xterm parser pump:       ordered <=32Ki code-unit writes, <=4 outstanding within one update
DOM debug data:          only last 8192 code units
```

最终 marker 必须只出现一次；batch 边界即使落在 `\u001b[38;5;` 与 `196m` 之间，也必须得到和未 batching 相同的 terminal state。

### late replay

```json
{
  "type": "terminal_replay",
  "configId": "local",
  "terminalId": "term_example",
  "replay": ["...bounded tail...", "FINAL_SENTINEL\r\n"]
}
```

replay 内容必须满足 `sum(Buffer.byteLength(chunk, "utf8")) <= 2MiB`；该上限不包含 JSON escaping、字段名或其他 message metadata。旧开头可以被淘汰，尾部 sentinel、chunk 顺序和 UTF-8 合法性必须保留。

### 失败例

```ts
new TerminalDeckManager({ replayLimit: 500 })
```

旧 option 必须在 TypeScript check 阶段失败；不得把它解释为 bytes，也不得静默忽略。

## 测试

### 结构化性能 oracle

* 20,000 个 tiny PTY chunks 经 deterministic scheduler 后，拼接结果逐字符一致，batch 数受 threshold/flush 次数约束，而不是 20,000。
* 20,000 个同 terminal browser messages 在同一 scheduler turn 只产生一次 state append；非-output barrier 前自动 flush。
* Terminal view append 不读取、比较或 join 完整旧 replay；bounded tail 始终不超过上限。
* 2MiB server replay window 保留尾部 sentinel，移除旧前缀，并保持 UTF-8 合法。
* 37,174,834-byte / 256KiB batch fixture 完成后，server replay logical bytes 不超过 2MiB、physical strings 不超过 4MiB，且 stale chunk 数不会随完整 burst 线性保留。
* split Unicode 与 split CSI/OSC fixture 在 batching 前后 parser 输入完全相同。
* parser pump 对任意 logical update 保持 exact concatenation、surrogate pair 完整、最多四个 outstanding、不同 logical update 不交叉，以及 generation reset invalidation。
* 真实 Bun WebSocket 在至少两次 backpressure/drain 周期内完整接收 37,174,834 bytes，逐 frame 顺序与内容一致，无重发、无丢失、pending 清零。

### 浏览器回归

Playwright 通过页面现有 terminal input 与唯一 app WebSocket 注入 37,174,834-byte deterministic real PTY output，不得额外创建长期 observer/input socket；使用末尾 marker 的 parsed revision 作为完成点，并断言：

* `data-rendered-tail` 长度有界且包含 marker；
* enqueue/consumed code-unit delta 都覆盖完整 37,174,834-byte ASCII fixture，且 consumed 不得大于 enqueued；
* write count 远小于 raw message count；
* fit count 不随 output chunk 数线性增长；
* 页面 heartbeat 在 output hydration 期间仍能推进，最大 frame gap 与 Long Task 都必须小于 100ms，并证明当前 Chromium 支持 Long Task observer；
* tab 切换、late replay、多 browser sync 和 reset 无重复、无丢失；same-content reset 也必须由新 `launchId` 强制 replace，旧 parser callback 不得回写新 generation。

墙钟只作为 hang guard 和 review 中的 before/after 诊断，不作为唯一 PASS 条件。

### Gate 命令

```text
just check
just build
just test-030
just test-unit
git diff --check
```
