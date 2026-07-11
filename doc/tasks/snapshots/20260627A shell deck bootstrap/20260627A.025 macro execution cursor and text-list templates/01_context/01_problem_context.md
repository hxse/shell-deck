# Problem Context

## 使用场景

用户经常把同一组 action 手写多遍，只替换阶段 prompt。例如一个 macro 依次向审阅 tab 发送“阶段 1”和“阶段 2”，每轮都 capture 结果、把 artifact 发到另一个 tab，再等待下一轮。用户希望把这些阶段文本写成一个数组，让同一套 body 按顺序执行：

```text
for each text in ["阶段 1", "阶段 2"]:
  send {{text}}
  capture-source
  send captured_text
```

循环里的文本不只出现在 terminal send。通知标题、通知正文、用户输入提示和 user-continue 提示也可能需要显示当前阶段，因此能力应覆盖真正的用户可见内容，而不是机械覆盖 JSON 里所有 string 字段。

## 需求痛点

当前 `for` 只有 count 和 forever，没有 item binding；用户只能复制整段 action。直接在现有 text 中解释 `{{text}}` 虽然 JSON 短，但会让同一段正文因为移动到某个 for 下而改变含义，历史内容里的双花括号也可能被误当模板。

更严重的问题在 runner。当前 resume 会从 root 再次执行，root body 依赖静态 `completedSteps` 跳过完成节点，而 for body 明确不跳过并从 iteration 0 开始。静态 step id 不能区分 `for_phases[0]/send` 和 `for_phases[1]/send`，也不能表达嵌套 loop 或 parallel lane 的位置。因此 loop 内的 wait/input/pause 恢复可能重复已经发生的 terminal write，循环 capture artifact 也只有 step id 维度，无法可靠表达“当前这一轮”的 producer occurrence。

这不是 text-list 的局部缺口。Pause/Resume 的产品语义本来就应是保存和恢复 continuation；若只给新 range 特判 index，count/forever、if、parallel 和 artifact 仍会继续使用不一致的恢复模型。

## 设计初衷

本任务把两个问题在同一条真值链上收口：for range 提供一个最小、固定、可验证的文本 binding；runner 则提供与具体 range 无关的动态 execution cursor。模板 expansion 只读取 immutable execution context，不把 current text 放进可变全局状态。Pause 在安全 action boundary 保存准确位置，Resume 继续同一个动态 invocation，而不是重新跑模板再猜哪些节点已完成。

UI 仍保持低门槛。用户先像现在一样添加普通 Text，只有主动勾选 `Use {{text}} template` 才切换底层 template 类型。这个选择同样适用于 title/prompt 等单字段文本，比给每个位置新增不同的 `Add Template` 入口更一致。

## 方案对比

### 方案 A：现有 text 隐式插值，runner 给 text-list 加局部 index

优点是改动看似最小。缺点是 literal 与 template 没有稳定类型边界，节点移动会静默变义；局部 index 也无法修复已有 loop、nested control、parallel 和 artifact resume。该方案会把同一个根因拆成更多特判，不采用。

### 方案 B：显式 template 类型加通用 execution cursor

普通 text 永远 literal，template 必须由用户显式开启并且只能出现在 text-list lexical scope。runner 使用 frame stack、execution path 和 occurrence-aware artifact environment 表达 continuation。它需要同时修改 schema、runtime、events 和 editor，但语义单一、可验证，并直接解决现有重复 side effect 风险。采用该方案。

### 方案 C：直接实现 named variables、object-list 和通用 expression engine

它可以表达 `{{phase.prompt}}`、`{{outer.text}}`、index 和动态条件，但会立即引入变量命名、nested lookup、escaping、expression parser、dynamic matcher 和安全边界。当前场景只需要一个文本 item，扩成通用语言会显著放大任务且没有停止线，不采用。

## 取舍结论

本任务固定唯一 binding 名 `text`，唯一 token 为 exact `{{text}}`。支持所有 lexical descendants，而不是只支持 for 的直接 children；内层 text-list shadow 外层，第一版不能同时引用两层 item。模板只开放给用户可见内容，条件与结构字段保持静态。

runner 修复是本任务的 Foundation Gate：count、forever 和 text-list 必须共用同一套 continuation model。若正常 pause/wait/input resume 仍会重复已完成 invocation，text-list UI 和插值即使可用也不得通过 Close Gate。
