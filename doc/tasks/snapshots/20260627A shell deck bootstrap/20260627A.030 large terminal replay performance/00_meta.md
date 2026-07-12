# 20260627A.030 Large Terminal Replay Performance

## 任务概括

修复真实 PTY 在短时间输出大量历史内容时，网页 terminal 首次加载长时间卡住的问题。实现必须保持输出顺序、TUI 控制序列、late replay 和多浏览器同步正确，不以丢输出或 Codex 特判换取速度。

## 正式 task 级别及定级原因

三星任务。

问题跨越 real PTY、server replay、WebSocket fan-out、Svelte 状态和 xterm 异步解析主链。局部优化若破坏 chunk 顺序、reset 边界或 replay retention，会让 TUI quietly wrong；因此需要完整 spec、分阶段 profiling、正确性回归和 post-review。

## 范围内

* 为 real PTY output 增加有时间与大小上限的顺序 coalescing。
* 把 shell replay retention 收敛为 byte-bounded tail，避免 replay 容量随 batch chunk 大小漂移。
* 在 browser 侧按 animation frame 合并 live output，并以显式 render revision 区分 append 与 replace。
* 在 xterm 边界使用 generation-aware `32Ki × 4` bounded callback pump，避免无上限 frame join 形成单次 parser long task，同时减少单 write outstanding 的调度空洞。
* 为每个 WebSocket client 增加 connection-local、byte-bounded pending queue；正确处理 Bun `send()` 的 accepted/backpressured/dropped 三种结果，并在下一 macrotask 继续 drain。
* 删除每个 output chunk 对完整 replay 的复制、prefix scan、全文 DOM attribute 和 layout measurement。
* 用 browser enqueue 与 xterm callback-consumed code units 建立分层、bounded test oracle。
* 增加大会话 burst 的离线结构化性能测试和真实浏览器回归。

## 范围外

* 不识别 Codex session，不读取或改写 session 内容，不增加 Codex 专用协议。
* 不实现 terminal 历史分页、全文搜索、下载或 server restart 后恢复。
* 不改变 macro terminal-buffer capture 的 source ownership。
* 不实现 durable WebSocket spool、自动 reconnect、跨连接重放或全局 PTY flow control。
* 不更换 xterm renderer，不把墙钟阈值作为唯一 Gate。
