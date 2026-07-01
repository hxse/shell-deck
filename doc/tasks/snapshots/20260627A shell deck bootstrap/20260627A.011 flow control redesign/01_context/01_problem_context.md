# Problem Context

当前 macro template 的可执行能力已经验证过，但流程控制暴露方式不适合用户长期使用。

现状问题：

* GUI 把普通动作和流程控制混在同一个 step button 区里：`send_line`、`capture-source`、`parse`、`branch`、`goto`、`pause`、`complete`、`fail`、`stop` 同级出现。
* 循环需要用户理解 `goto + loopGuard.maxIterations`，这是 runner 内部控制流模型，不是宏用户的自然心智。
* `branch` 不是用户熟悉的 `if/elif/else`，配置结构虽然正确，但 GUI 语义不直观。
* `pause` 和 `stop` 被做成 template step 会污染宏语言。用户期望它们是 runner 控制按钮，而不是脚本内部语句。
* `complete` 更像 `return`；`stop` 是外部强停，两者不应该在模板语言里混淆。
* 现有 flat step list 很难表达嵌套结构。用户希望 GUI 能用类似代码块缩进的方式展示流程：

```text
for round in range(3)
│ send_line reviewer
│ if onlyP3OrClean == true
│ │ return
│ else
│ │ send_line worker
│ │ continue
sleep until resume
```

本任务的核心判断：

* 宏语言应该保留结构化 JSON，不引入字符串 DSL，不使用 `eval`。
* GUI 应该展示接近 Python 的控制流名称和块结构。
* runner 的 Start/Pause/Resume/Stop 是运行控制，不属于 template flow control。
* `sleep` 是普通动作，可以覆盖定时睡眠和“等用户 Resume 后继续”的暂停式等待。
