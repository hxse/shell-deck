# Problem Context

## 问题是什么

当前 Macro 的 `enter: true` 实际不是“按下 Enter”，而是 runner 固定在文本后追加 LF（`\n`，`0x0A`）。普通 shell 的 canonical input 通常会让 LF 和物理 Enter 都表现为提交，所以旧行为长期看似正确；Codex 等 raw-mode TUI 会区分控制字节，于是 LF 只产生换行，没有触发提交。

浏览器中的真实 Enter 由 xterm 映射为 CR（`\r`，`0x0D`），WebSocket、terminal manager、real PTY backend 和 helper 都原样转发。问题因此不在 Codex，也不是 pause/resume 特例，而是 Macro 公开文案和实际 terminal input byte 不一致。

## 用户场景

用户既要向普通 shell 发送命令，也要向 shell 内运行的交互式 TUI 发送文本。Macro 必须能明确控制文本后的字节：

* CR 用于表达与 xterm Enter 相同的输入，作为新建 action 默认值。
* LF 可显式表达 line feed。
* CRLF 可用于确实要求两个连续字节的目标。
* None 保留“只写文本、不追加结尾”的现有能力。

CRLF 是两个独立字节。在 raw-mode TUI 中，CR 可能先提交，随后 LF 被下一状态消费；UI 负责准确命名，而不把它包装成另一种提交按钮。

## 方案选择

### 方案 A：保留 boolean，只把 true 从 LF 改成 CR

能修复当前 Codex TUI 场景，但无法表达用户明确要求的 LF/CRLF，拒绝。

### 方案 B：保留 checkbox，再增加 sequence 选择

会形成两份状态：checkbox 决定是否追加，select 决定追加什么。两者组合增加无效/隐藏状态，也继续把所有选择叫作 Enter，拒绝。

### 方案 C：单一 ending enum

用一个互斥 select 表达 None/LF/CR/CRLF，JSON 也只保留一个 required enum。它直接对应 runner 最终追加的字节，UI、schema、runtime 和 evidence 共用同一术语，是本任务采用方案。

## 破坏性边界

旧 `enter` 不迁移、不读取、不推导成 `ending`。缺少 `ending` 也不能在 validator、store 或 runner 中补 CR；只有编辑器创建新节点时显式写入 `ending: "cr"`。这样默认值属于 authoring 行为，而不是隐藏的 runtime fallback。

Run log 是 append-only evidence，不属于 Macro authoring schema。已经落盘的旧 event 不会被改写；但 current producer、demo 数据和普通测试 fixture 全部切到新的 `ending` evidence，不新增 legacy branch。

## 文档关系

`.022` 建立了 `enter: boolean` 并错误冻结 LF；本任务破坏性替换该 contract。`.018` 的 parallel lane send、`.025/.026` 的 scoped templates/cursor 和 `.027` 的 current-schema-only fail-fast 原则继续保留。本任务不回写旧 snapshot，Close Gate 后同步当前 Macro active spec、run-log evidence说明、Quickstart 和 task index。
