# Problem Context

## 使用场景与痛点

本任务处理的是五个彼此独立、但都属于“边界已经明确，实现没有完全守住”的缺口。

Trace 的 summary 只在若干 checkpoint 更新。用户若先打开 summary page，现有 freshness repair 会补齐普通 event；但若直接请求 event page，旧实现会信任 stale summary，从而暂时隐藏已经 durable 的事件。

Room WebSocket upgrade 会冻结当时的 generation。若 open 前 Room 被 Destroy 并以同一 token 重建，旧 socket 不能注册到新 generation。旧实现却先注册、甚至可能取得 controller，再比较 generation；失败清理又拿不到尚未写回 socket data 的 client ID。

Content edit lease 的 acquire/takeover 会先把 held state durable publish，再复核 controller authorization。授权若在两步之间丢失，新 lease 尚未进入 process-owned map，controller cleanup 看不到它，会留下直到 TTL 才消失的 phantom lease。

Trace index 的 lock 仍写入 `locks/`，而 User Data Root 的唯一 managed lock directory 是 `.locks/`。此外 400 行 scanner 只有 hard failure，文件接近上限时没有提前信号。

## 方案取舍

这些问题不需要新增兼容层或重做公开 contract。选择沿现有 ownership 修复：

* Event page 复用 `EvidenceStore` 已有 per-run freshness marker；只有首次 cold access 做首尾验证，warm page仍只读目标 range。
* generation 比较进入 client registration 的同步临界区，在任何 registry、message 或 controller mutation 前完成；registration 后续失败则回滚该次临时 controller transition。
* lease 回滚继续走同一 per-record transaction，只在磁盘 state 与刚发布的 exact lease identity 相同时释放，绝不覆盖并发产生的新 lease。
* Trace index 从统一 User Data Root path helper取得 `.locks`。
* 350 行信号定义为 non-blocking file-size advisory，400 行 hard Gate保持不变；本任务不借此展开新的大文件拆分。

Origin/session proof、resource envelope 和 retention 都存在产品取舍，明确留在本任务之外。
