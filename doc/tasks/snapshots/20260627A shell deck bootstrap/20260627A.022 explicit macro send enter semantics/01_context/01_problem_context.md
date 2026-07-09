# Problem Context

当前 Flow V2 的 `send_line` / `input_line` 名字和行为都暗含“发送一行并提交”。runner 实现会在渲染文本后硬编码追加 `\r`，导致几个问题：

* `message.text = "hello text"` 会被 shell 当成命令提交，用户看到 `bash: hello: 未找到命令`。
* `message.text = "hello text\n"` 会变成文本自带换行再叠加 runner 自动提交，语义重复。
* Codex TUI 路径里 `\r` 和 `\n` 的效果不一致；当前产品真正需要的是 ShellDeck 定义的提交动作，而不是让模板用户关心物理控制字符。
* `message` artifact 只记录渲染文本，不记录 runner 补上的提交符，审计时看不出真实写入终端的 payload。

问题本质不是应该 trim 还是保留空白，也不是用户该不该手写 `\n`。问题是模板把“文本内容”和“提交动作”混在了一个隐式 action 里。

## Design Principle

Macro JSON 必须显式区分：

* `message` / runtime user input：用户要发送的内容，原样保留，不 trim，不补分隔符。
* `enter`：发送内容后是否触发一次 ShellDeck 定义的提交动作。

模板保存结构化意图；runner event log 记录实际写入结果，方便调试和审计。
