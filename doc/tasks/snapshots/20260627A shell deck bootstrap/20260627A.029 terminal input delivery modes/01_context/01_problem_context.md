# Problem Context

## 问题是什么

`.028` 已经证明 shell-deck 会精确写出 None/LF/CR/CRLF，但它把“原始后缀字节正确”误当成了“目标 TUI 一定按键盘语义处理”。真实 Codex TUI smoke 发现：较长正文与 CR 在同一次快速 PTY stream 中到达时，CR 只在 composer 中产生换行，没有提交 prompt。

当前 runner 在 `writeTerminalText` 中先构造 `content + ending`，再用一次 `manager.input` 送入 terminal。Manager、real backend 与 PTY helper 都原样转发；问题不是 CR 被 normalize，也不是 output renderer。

Codex TUI 为没有明确 bracketed-paste marker 的快速字符流实现了 PasteBurst heuristic。连续字符进入 burst 后，紧随其后的 Enter 会被当成 paste 内部换行；raw LF 则对应 Ctrl+J，同样是 insert-newline。两者视觉相同，但原因不同。官方 `rust-v0.144.1` 源码与 `ascii_burst_treats_enter_as_newline` 测试明确冻结了该行为。

## 真实验证

本任务前的只读 probe 使用本机 `codex-cli 0.144.1` 和本地 `/keymap` 命令，不提交模型请求：

* 短 `/keymap + CR` 可提交。
* 长 burst `/keymap ... + CR` 只换行。
* burst 结束后再单独发送 CR 可提交。
* `disable_paste_burst=true` 时长 burst + CR 可提交。
* `ESC[200~ + /keymap ... + ESC[201~ + CR` 即使同批写入也可提交。

官方证据：

* PasteBurst 常量与 Enter suppression：<https://github.com/openai/codex/blob/rust-v0.144.1/codex-rs/tui/src/bottom_pane/paste_burst.rs>
* Composer explicit paste 与回归测试：<https://github.com/openai/codex/blob/rust-v0.144.1/codex-rs/tui/src/bottom_pane/chat_composer.rs>
* Codex 开启 bracketed paste：<https://github.com/openai/codex/blob/rust-v0.144.1/codex-rs/tui/src/tui.rs#L175-L180>

## 方案选择

### 方案 A：把 CR 换成 LF、CRLF 或 CSI-u Enter

LF 在 raw Codex TUI 中是 Ctrl+J；CR/CSI-u Enter仍会进入同一个 PasteBurst suppression。CRLF 还可能在 submit 后把第二个控制字节送入下一状态。拒绝。

### 方案 B：正文和 ending 分两次 write，中间固定 delay

100-200ms 在当前 Codex 上大概率绕过 heuristic，但它依赖版本、平台和 event-loop tick。更重要的是，一次 Macro send 会变成两个可观察副作用：进程若在正文已写、ending 未写之间退出，resume 会重发正文，除非再增加 phase cursor。拒绝作为正式 contract。

### 方案 C：启动 Codex 时关闭 PasteBurst

`disable_paste_burst=true` 是可用的用户侧 workaround，但它是 Codex-specific 配置并改变目标程序自己的 paste 防护。shell-deck V0 编排 terminal，不应通过 runner 或 wrapper 隐式改写第三方程序配置。拒绝作为产品 contract。

### 方案 D：显式 delivery mode

保留 direct 原始写入，并增加显式 bracketed-paste framing。Paste end marker 让目标 parser 先产出完整 Paste event；随后 marker 外的 CR 才作为独立 Enter 处理。整个 payload仍可由 runner一次逻辑 dispatch，避免 delay和中间 phase。采用。

### 方案 E：Auto 作为新节点默认值

后续真实使用发现，Bracketed paste 对启用 Readline/DEC 2004 的 Shell 与 Codex TUI 都正常，但 Text panel 不解释 framing，因而会把 `[200~` / `[201~` 当正文显示。让所有新节点默认 Direct 会继续要求用户知道 Codex PasteBurst；让所有新节点默认 Bracketed paste 又会污染 Text。

现有 tab capability 已经稳定区分 Shell 与 Text，因此 Auto 只做 target-kind resolution：

```text
Auto + Shell -> Bracketed paste
Auto + Text  -> Direct bytes
```

这个判断不识别前台进程，也不读取 `CSI ? 2004 h/l`。Direct 与 Bracketed paste继续作为用户强制 override；显式选择绝不被 Auto 逻辑覆盖。采用 Auto 作为 normal send、input 与 parallel send 的新建默认值。

Ending sequence仍是独立raw suffix。当前 CR 已同时满足真实 Shell 与 Codex bracketed-paste smoke，因此不增加 Ending Auto；避免把两个正交维度重新绑成一套隐式 profile。

## 破坏性边界

`delivery` 是 required own-enumerable current-schema field，current enum为 `auto | direct | bracketed-paste`。旧 template 缺少它时，validator、store、HTTP 和 runner start 全部 fail loudly；只有 editor创建新节点时显式写 `"auto"`。不增加 optional field、missing default、migration、alias 或 dual reader。

Auto 不是 terminal protocol探测：它只读取已解析target的 current Shell/Text capability。Runner在实际提交时解析，保证 runtime input等待期间target backend变化后使用最新capability；不会把resolved值写回template。未来若要根据child output跟踪 `CSI ? 2004 h/l`，必须另开task。

## 文档关系

`.029` 破坏性扩展 `.028` 的 terminal input contract：`ending` 保持原始后缀真值，但 `.028` 把 raw CR 文案等同于 Enter submit 的推断由本 task 纠正。Auto 三模式属于同一个 `.029` delivery contract，不拆新task。保留 `.025/.026` 的准确cursor与scoped template、`.027` 的current-schema-only原则；Close Gate后同步Macro active spec、run-log active spec、Quickstart和task index。
