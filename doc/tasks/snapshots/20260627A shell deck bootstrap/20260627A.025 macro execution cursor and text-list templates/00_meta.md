# 20260627A.025 Macro Execution Cursor And Text-List Templates

## 任务概括

为 Flow V2 `for` 增加可迭代静态文本数组的 `text-list` range，并让循环词法作用域内的用户可见内容显式引用当前 `{{text}}`。同时把 runner 的 pause/resume 从“重新遍历模板并按静态 step id 猜测完成位置”改成 occurrence-aware execution cursor，保证正常暂停、等待和输入恢复时从准确的动态 invocation 继续。

## 正式 task 级别及定级原因

三星任务。

本任务同时修改 macro template 公开 schema、validator 词法作用域、runner 核心控制流、循环内 artifact occurrence、run-log 可观测语义和 Macro editor。当前 runner 在循环暂停后可能从第 0 轮重进并重复 terminal side effect，属于 quietly wrong 的高风险正确性问题；模板能力若隐式解释既有 text，也可能让已有正文静默变义。因此必须使用完整文档 Gate、分阶段实现、AI pre-review/post-review 和 Close Gate。

## 范围内

* 新增 `{ "kind": "text-list", "items": string[] }` for range 和固定 `{{text}}` binding。
* 新增显式 template text 形态；普通 text/string 继续保持 literal。
* 在 `send`、`notify`、`input.prompt` 和 `wait.user-continue.prompt` 的用户可见内容上提供 scoped template。
* 支持 `if`、control-terminal action body、内层 count/forever 和 parallel lane 等 lexical descendants；嵌套 text-list 使用最近 binding shadow 外层。
* 引入通用 execution cursor、动态 invocation identity、循环 checkpoint、occurrence-aware artifact environment 和安全 pause boundary；统一修正 count、forever、text-list 的正常 resume 行为。
* 为新 schema、runner、run events、editor 和恢复不变量补齐 focused unit/integration/E2E coverage，并在收口时同步 macro template、run log、AgentEvent capture active specs、quickstart 与 task index。

## 范围外

* 不实现通用 expression language、自定义变量名、outer binding 引用、`{{index}}`、`{{last}}`、object-list 或动态 list source。
* 不给 condition matcher、regex/extract rule、parallel label/separator、control reason、id、terminal selector 或 artifact selector 增加模板能力。
* 不递归展开 item、artifact 或用户运行时输入中恰好出现的 `{{text}}`。
* 不改变 parallel lane 当前允许的 action 集合；notify/input/user-continue 仍不因本任务进入 lane。
* 不承诺 server process restart 后继续 in-flight run；当前任务保证同一 runner 生命周期内的正常 pause/wait/input resume。execution cursor 必须可序列化，但 durable restart resume 另行设计。
* 不解决 terminal write 已成功、对应 event/checkpoint 尚未落盘时进程崩溃的严格 exactly-once 窗口，也不恢复 terminal 内第三方程序或 Codex session。
