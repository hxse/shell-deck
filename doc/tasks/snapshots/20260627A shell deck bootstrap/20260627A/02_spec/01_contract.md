# Contract

## 任务边界

父任务只定义 `shell-deck` V0 蓝图，不承载全部实现细节。V0 的核心产品判断是：系统编排 terminal，不编排 Codex；宏是用户可编辑、可暂停、可追溯的 agent-output-aware terminal automation，而不是后台 role loop。

范围内：

* 定义 V0 必须交付的能力集合。
* 定义九个阶段子任务的职责和交付顺序。
* 定义所有子任务共同遵守的硬边界。
* 定义 V0 完成规则。

范围外：

* 不在父任务里冻结每个 API、每个 UI 表单字段或每个 event payload 的完整细节。
* 不在父任务里实现代码。
* 不让父任务替代子任务 Close Gate。

## 任务规范

### V0 产品蓝图

`shell-deck` 是 local-first browser terminal deck。一个 local server 可以承载一个或多个 `ConfigScope`。同一个 config 下的多个浏览器 tab 共享 terminal、macro template、macro run 和 agent output state；不同 config 必须隔离，不能把配置 A 的 terminal 序号或 run state 用到配置 B。

每个 config 内有多个 terminal。terminal 有两种公开标识：

* `terminalId`：稳定、唯一、不可变，使用 `short-uuid` 生成，保存为 `term_<shortUuid>`，例如 `term_7k3p9d`。它跟着 live terminal 走，terminal 移动位置也不变。
* `terminalIndex`：当前 config 内的动态序号，例如 `1`、`2`、`3`。它方便用户选择，但不是稳定身份，移动或重排 terminal 时可以重新映射到不同 `terminalId`。

macro template 支持两种 terminal 引用：按序号引用，也可以按稳定 id 引用。运行时所有引用都在当前 `configId` 下解析成 `terminalId`，然后再发送输入、等待 agent output 或匹配 `AgentEvent`。用户不需要手动维护 index/id 映射，server 必须实时维护。

Terminal alias 是同一套映射的快捷名。server 必须实时维护 `terminalIndex -> terminalId`、`alias -> TerminalRef -> terminalId` 和 live terminal order；用户移动 terminal 后 index 映射自动更新，alias 绑定 stable id 时跟随 terminalId，alias 绑定 index 时跟随当前 index。macro run 执行前和恢复后都必须重新解析 TerminalRef，用户不需要手动更新这些绑定。

每个 terminal 默认启动 shell。系统不预启动 Codex，不注入 prompt，不绑定 Codex session。Codex、shell command、test watcher、debug server 或其它 TUI 都只是 terminal 里的普通进程。

需要 parser capture 的 Codex 可以通过 shell-deck `justfile` 的 `codex` recipe 启动。用户在目标项目目录执行 `just -f <shell-deck-root>/justfile -- codex <codex args...>`；recipe 透传所有 Codex 参数，并通过临时 config override 注入 shell-deck hook。它不能安装全局命令，不能修改用户全局 Codex 配置，也不能改变普通 `codex` 调用行为。Codex adapter 现在就必须上报 Codex `session_id`，归一化为通用 `agentSessionId`，并在 adapter metadata 中保留 `codexSessionId` 供调试和未来 session mapping 使用。

AgentEvent capture 必须经过统一 `AgentEvent Ingest` 协议进入 shell-deck。Codex 原生 hook 的通信方式是本地 command hook：Codex 把 hook payload JSON 写入 hook 进程 `stdin`，hook 通过 `stdout` JSON 和 exit code 返回给 Codex。这个机制只存在于 `codex` adapter 内部。adapter 负责把 Codex payload 归一化成 `AgentEvent`，再通过 shell-deck local-only ingest endpoint 或 fallback JSONL spool 交给 server。macro runner、parser 和 event log 对 agent callback 只消费 `AgentEvent`，不能直接依赖 Codex hook 字段。

macro panel 是 V0 的核心体验。用户通过可视化面板管理 JSON macro template，并让宏作为傻瓜 terminal automation 工具执行用户配置的原语：向指定 terminal 写一行文本并发送 Enter、等待、sleep、请求用户输入一行并转发、按模板选择 capture source、调用 parser、按结构化条件分支、执行 `if/else`、`goto`、带 `loopGuard.maxIterations` 的简单回跳循环、受限 `parallel_all`、暂停、恢复、停止当前 run 后切换到其它宏，或切换到其它 config 运行宏。runner 不理解 Codex、shell command、用户拍板等业务语义，只执行模板里写明的步骤。

Parser 主输入由 macro template 的 capture source 决定。V0 默认 source 是 `terminal-buffer`，也就是直接从 terminal replay/scrollback/screen buffer 截取原始 TUI 文本；它灵活但可能包含 ANSI、局部重绘、折行、进度态和截断。用户也可以选择 `agent-event` source，例如 `codex-stop-hook` adapter 产生的 `eventKind=agent.output` 的 `AgentEvent`，由 Codex Stop hook 提供 `last_assistant_message`，结构更干净但需要通过 shell-deck `justfile` 的 `codex` recipe 启动。shell-deck 不替用户假设哪种 source 更正确，runner 只记录 source kind、raw artifact 和 parser result。`wait` 只等待 readiness、quiet、duration 或用户继续；`capture-source` 是 V0 唯一的 capture artifact producer；`parse` 只读取同一 run 内对应 source 最近一次已完成 `capture-source` 产出的 artifact。

Parser V0 只提供两类工具：`ai-json` 和 `regex`。`ai-json` 使用内置 profile 让一次性模型调用返回 JSON，再经过 schema/normalize 收口；`regex` 使用用户在模板中配置的正则规则从文本中提取 signals。两者输出进入 branch 前都必须 normalize 成 typed signals。`boolean-null` 的最终值只允许 `true`、`false`、`null`；原始字符串 `"true"`、`"false"`、`"null"` 只能在 parser normalize 阶段按规则转换，branch compare 阶段不做宽松比较。

RunEventLog 是宏执行唯一真值。UI 节点展开日志和 AI 追溯日志都从同一份 append-only event log 与 artifacts 派生，不能产生两份状态真值。

V0 每个 `ConfigScope` 同一时刻最多允许一个 live macro run。live run 包括 `running`、`paused`、`waiting`、`waiting_user_input` 和可恢复的 `interrupted`；不包括 `completed`、`failed`、`stopped`。当当前 config 已有 live run 时，启动新 run 必须失败并提示用户先 resume、stop、complete 或切换到另一个 config。不同 config 之间隔离，可以并行运行各自的 macro run。这个限制只约束 macro runner 自动执行，不限制用户手动在 terminal 里输入。V0 唯一有限并发能力是单个 run 内的 `parallel_all` step：它只能把静态 lane 分发到不同 terminal，复用通用 capture/parser/condition，全部 lane 成功后再继续。

V0 恢复 macro，不恢复 agent。模板、run log、artifacts、paused/interrupted/completed state 可恢复；terminal 内运行的 Codex session 或其它第三方程序不自动发现、不绑定、不恢复。若使用 Codex hook，deck runtime 可以记录 `configId + terminalId + agentSessionId` 到 capture source runtime state 的映射，但 macro template 仍不能保存 Codex session。


### Identifier Contract

所有会进入 URL、WebSocket scope、本地文件路径、JSON template 或 event log 的公开 id，都必须先按统一规则校验，再参与路径拼接或状态解析。

V0 通用 id 规则：

* `configId`、`templateId`、`deckId`、`runId`、`stepId`、`sourceId`、alias name 使用 `^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$`。
* 禁止空字符串、`.` 开头、`..`、`/`、`\`、空格、控制字符和 URL/path 分隔符。
* id 保持大小写原样，server 不做大小写折叠；同一 scope 内 exact match 唯一。UI 可以推荐小写，但不能偷偷改写用户输入。
* `terminalId` 由 server 生成，格式固定为 `term_<shortUuid>`；用户不能手写任意 terminalId 创建 live terminal。
* `eventId` 由 server 生成，格式固定为 `evt_<shortId>`；同一 run 内必须唯一。
* `agentSessionId`、`codexSessionId` 是第三方 id，不能用于 filesystem path，只能作为 event data 字段保存。

路径规则：

* 任何 path join 前必须先验证 id；不能把未验证字符串放进 `.shell-deck/configs/<config-id>/...`。
* 所有存储路径必须 normalize 后确认仍位于对应 config/run root 内。
* `artifactRef` 只能由 server 生成，格式为当前 run 内的相对路径，例如 `artifacts/send-0001.txt`。client/template/parser 只能引用已有 ref，不能提交任意 path。
* 拒绝 absolute path、`..` segment、反斜杠、symlink escape 和 normalize 后离开 run artifacts 目录的 artifact ref。
* import/export 时，外部文件里的 id 必须重新校验；不合法时导入失败并给出 validation error，不能自动修正成另一个 id。

### V0 子任务

`20260627A.001 v0 api probe` 负责验证两条底层 API 主线：一是 shell-deck `justfile` 的 `codex` recipe、临时 hook 注入、SessionStart/Stop payload、必填 Codex session id 上报和 `AgentEvent Ingest`；二是参考 `orch-web` 已测行为重新冻结 terminal deck WebSocket baseline、multi-tab sync、config isolation、PTY input/resize/replay、helper stdin pipe 和 terminal-buffer capture。

`20260627A.002 terminal deck foundation` 负责项目初始化、local server、config scope、terminal slot、真实 PTY、multi-tab sync、replay、resize、输入延迟基线和 terminal smoke tests。

`20260627A.003 macro template workbench` 负责 macro template schema、持久化、基础可视化 CRUD、复制、导入、导出、终端 ref、alias 快捷引用和 capture source/profile 引用配置。它不执行宏，也不实现 parser profile bundle。

`20260627A.004 run log and artifacts` 负责 append-only run event log、artifact 存储、derived state rebuild 和节点日志视图，是后续 runner 的可观测底座。

`20260627A.005 macro runner state machine` 负责最小 runner 状态机，以及 `send_line`、`wait`、`sleep`、`input_line`、`capture-source`、`parse` stub、`branch`、`goto`、带 `loopGuard.maxIterations` 的简单回跳循环、`pause`、`complete`、`fail`、`resume`、`stop` 的 mock/stub 闭环。完整 `for_each`、item binding、嵌套循环、`break` 和 `continue` 留给 V1 单独设计。

`20260627A.006 capture source and agent event adapters` 负责真实 `terminal-buffer` capture、`AgentEvent Ingest` endpoint、Codex Stop hook adapter、JSONL spool fallback 和 capture artifact 写入。

`20260627A.007 parser profiles and adapters` 负责 parser adapter interface、`regex` parser、`ai-json`/`codex exec` one-shot Spark probe、内置 ParserProfile bundle、schema validation、soft signals、replicas disagreement pause 和 fixture eval。

`20260627A.008 bounded parallel lanes` 负责单个 run 内的受限 `parallel_all` fan-out/fan-in：不同 lane 指向不同 terminal，复用 terminal-buffer/AgentEvent capture、regex/ai-json parser 和结构化 success conditions。

`20260627A.009 v0 closeout` 负责 quickstart、active specs 同步、端到端验收、review/verification 报告和已知限制。

### 共同硬边界

* 不引入 role、agent、coder、reviewer、validator 作为核心对象。
* 不引入 sealed instruction、caller proof、Codex launcher 或 blocking role operation API。
* V0 可以使用 Codex Stop hook 捕获 agent 输出，但不能用 hook 做后台 loop 或强行续跑 Codex。
* `codex` just recipe 只能临时注入 hook 配置，不能修改用户全局 `~/.codex/config.toml`，不能安装全局 `sdcodex`。
* hook adapter 只需要上报 `configId`、`terminalId`、`launchId` 和 `agentSessionId`；Codex adapter 还必须保留 `codexSessionId` metadata，不要求上报 terminal 序号。
* 核心 runner、parser 和 event log 只消费统一 `AgentEvent Ingest`，不能特判 Codex hook；Codex、其它 agent adapter 或普通 command adapter 都必须归一化到同一事件形态。
* macro template 可以保存 terminal index ref 或 terminal id ref，但不能保存 Codex session。
* `terminalIndex` 是当前 config 内的动态选择器；`terminalId` 是稳定身份。所有 macro run 必须把 terminal ref 解析到 `terminalId` 后执行。
* 同一个 server 下，不同 `configId` 的 terminal、index/id mapping、macro run、agent output event 必须隔离。
* parser 只产生 soft signals；系统事实审计不能伪装成 parser 真值。`regex` 和 `ai-json` 都不能替代 terminal instrumentation、command log 或 filesystem diff。
* parser 布尔类字段使用 `true / false / null`，`null` 表示无法判断。
* parser 可以在 normalize 阶段把严格匹配的原始字符串 `"true"`、`"false"`、`"null"` 转成 typed value；branch compare 必须只比较 normalized typed value，不允许 `"true" == true` 这类宽松比较。
* 涉及系统事实的 parser 字段必须使用 `claims*`，例如 `claimsFileWritten`、`claimsNonReadonlyJj`。
* V0 允许用 `branch`/`goto` 做简单循环，但任何回跳边都必须声明 `loopGuard.maxIterations` 和 `onLimit=pause|fail`；不能出现无上限后台 loop。完整 `for_each`、item binding、嵌套循环、`break` 和 `continue` 不进入 V0。
* 真实 PTY 从第一版开始采用 helper stdin pipe 控制通道，不能把 command-file polling 当主输入路径。
* 默认只绑定 `127.0.0.1`；LAN 暴露必须显式开启，并留到后续访问控制任务收口。

### V0 完成规则

九个子任务按顺序通过 Close Gate 后，V0 可以交付。交付定义是：用户能启动本地 web server，打开多个浏览器 tab 操作同一 config 下的多个 terminal，用 shell-deck `justfile` 的 `codex` recipe 启动可捕获输出的 Codex，创建和复用宏模板，按 terminal index、terminal id 或 alias 选择目标 terminal，执行 send-line、sleep、input-line、capture、parse、branch、受限 parallel_all 和基础流程控制，运行可暂停可恢复的宏；同一 config 只能有一个 live run，不同 config 可并行；用户能展开每个节点查看同一份 event log，并在 parser 失败或用户配置的分支条件命中时接管。

V0 不要求 Codex session binding。用户可以自己在 terminal 里运行 `just -f <shell-deck-root>/justfile -- codex resume --last`、新启动 Codex，或者完全不用 Codex 只编排 shell command。使用 parser 分支时，模板可以选择默认 `terminal-buffer` 原始 TUI capture，也可以选择 `agent-event` capture；普通 shell command 仍更适合封装成脚本和 exit code，但系统不禁止用户把 terminal buffer 交给 parser。

## 示例

V0 最小使用链路：

```text
1. 用户启动 shell-deck local server。
2. 用户打开 config local，看到 terminal 1 和 terminal 2；它们分别映射到 term_a1b2 和 term_c3d4。
3. 用户在目标项目目录运行 `just -f <shell-deck-root>/justfile -- codex resume --last`。
4. `codex` just recipe 通过临时配置注入 SessionStart/Stop hook，并把 SHELL_DECK_TERMINAL_ID=term_c3d4 暴露给 hook。
5. Codex Stop hook adapter 读取 last_assistant_message 和 terminalId=term_c3d4，通过 AgentEvent Ingest 写入 shell-deck agent output log。
6. 用户在 macro panel 选择一个 review/fix 模板，目标可以写 terminal index 2，也可以写 terminal id term_c3d4。
7. runner 在 config local 内把 index 2 解析为 term_c3d4，并按模板等待后执行 `capture-source`，默认从 terminal-buffer 截取 capture artifact。
8. 如果模板选择 agent-event source，则 runner 等待 matching AgentEvent readiness 后，由 `capture-source` 写入 capture artifact。
9. parser 抽取 hasAiFixable / needsUserDecision / onlyP3OrClean 等 soft signals。
10. runner 根据用户配置的 structured branch 选择下一步；如果跳到 `input_line`，UI 浮现输入框，等待用户输入一行并发送到目标 terminal 后继续。
11. 用户移动 terminal 位置后，server 更新 index/id 映射；adapter 仍按 terminalId=term_c3d4 上报。
```

## 测试

父任务不直接定义可执行测试。测试要求由九个子任务分别冻结，并在 `20260627A.009` 做 V0 总收口。父任务文档 Gate 的检查点是：阶段拆分是否覆盖 V0 交付、边界是否足够清楚、是否没有把 role/Codex orchestration 重新引入，且 parser 主输入由用户可选 capture source 决定，hook 注入没有污染用户全局 Codex 配置，terminal identity 与 config isolation 语义清楚。
