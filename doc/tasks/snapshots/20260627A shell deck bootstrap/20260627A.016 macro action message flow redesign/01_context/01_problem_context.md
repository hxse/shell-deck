# Problem Context

`.011` 和 `.012` 已经把 Macro Flow V2 从 v1 的 `next/branch/goto/loopGuard` 推向 block-tree，但 action 层仍然残留太多历史负担：

* `sleep` 和 `wait` 职责重叠。用户心智里只需要“等待/暂停”，不需要两个动作。
* `wait.capture-ready-or-user` 把 capture readiness 当成等待条件，但宏是顺序执行的；需要 capture 时就显式执行 `capture-source`，不应该用 wait 预判 capture 是否 ready。
* `parse` 作为独立 action 会制造第二条数据流：`capture -> parse -> branch/send`。用户真正需要的是：从 terminal 抓文本，然后用条件判断文本是否匹配。
* 内置 `ai-json` parser action 与项目方向不匹配。用户可以把 capture 文本发送给另一个 terminal 里的 Codex，由 Codex 做 AI parsing，再 capture Codex 输出。shell-deck 不需要把 AI parser 封装成后台 action。
* `send_line` 旧 UI 仍把 source、prepend、append 分成固定槽位，容易把顺序和含义混在一起；`input_line` 旧设计还把用户输入塞进 message part，运行时编辑语义不清。
* `capture-source` 的 AgentEvent 当前实际只支持 Codex，但 UI/schema 应提前表达 agent adapter 选择，否则未来接更多 agent 时会变成特判。
* `parallel_all` 容易被误解成通用并发子语言，甚至出现默认 `echo ready` 这类无意义默认发送文本；真实需求只是并发发送多条普通 send，然后抓取并合并结果。

新的方向是把宏语言收敛为三条简单规则：

1. 想获得 terminal/agent 文本，统一走 `capture-source`。
2. 想把文本发到 terminal，普通自动发送统一走 `send_line` ordered text/source parts；需要人工修改时走 `input_line` prompt + optional defaultSource。
3. 想基于文本走分支，直接在 `if` condition 中配置 text match；不再创建 `parse` action。

这样保留宏面板的灵活性，也让 AI parsing 退回用户可观察、可接管的 terminal 编排，而不是后台黑盒。
