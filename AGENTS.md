# AGENTS.md - shell-deck 协作入口

本项目遵循 `<pyo3-quant-root>/AGENTS.md` 的文档和审阅规范。当前设计真值在正式 task 通过 Gate 前以 `doc/tasks/snapshots/**/02_spec/**` 为准；实现收口后再同步到 `doc/tasks/active_specs/**`。

## 当前项目目标

`shell-deck` 是一个 terminal-first macro automation 工作台。它提供同一用户通过多标签页或设备连接同一 Room、一个 Room 内多个 terminal slot，以及可视化 macro panel，用可暂停、可追溯的宏模板编排终端输入、等待、capture source、Spark parser解析和分支。同一Room由server强制single-controller顺序控制，其他连接只读观察，不建立多人协作模型；user-global Macro/Library saved record另由跨Room/process的per-record edit lease保护。默认capture source是terminal-buffer原始TUI截取，也支持Room-scoped AgentEvent/Codex hook capture。

## 工作方式

* 全程中文沟通，关键技术术语保留英文。
* 当前项目焦点只看 `shell-deck` 自己的源码和文档；`orch-web` 只作为 terminal 底座经验来源，不再作为产品方向真值。
* 新正式任务必须先写 task 文档，结构遵循 `doc/tasks/` 分层。
* 查询当前真值时优先看源码和 `doc/tasks/active_specs/**`；若 active spec 尚未冻结，则看当前 task 的 `02_spec/**`。
* 默认采用 current-schema-only 的破坏性演进：不兼容旧语法、不读取或处理旧语法，优先直接替换旧 contract；不得添加 alias、migration、dual schema、legacy branch 或自动转换。旧输入必须按当前 schema fail loudly。只有用户在具体 task 中明确要求兼容时才可例外，并必须把兼容边界冻结到该 task 的 `02_spec/**`。
* 破坏性schema/API演进不授权无关UI或既有交互重做。重构默认保留仍符合新contract的布局、视觉语言、组件行为与使用流程，只修改任务明确要求或新contract必需的局部；可以从前序revision移植presentation/interaction实现，但不得借此恢复旧schema、adapter或兼容分支。任何有意UI偏离都必须在对应task的spec/plan/review写明理由；未写明的变化视为越界。
* 审阅报告按 P1/P2/P3 分级，并区分“AI 直接修”和“需要用户拍板”。
* 不把 `orch-web` 的 role / Codex orchestration 默认迁移过来；只有 terminal/PTY/multi-client sync 等被当前 spec 明确保留的底座能力才进入 `shell-deck`。

## 技术边界

* V0 编排 terminal，不编排 Codex。Codex 只是用户可能在 terminal 中运行的程序之一。
* 所有 shell-deck 项目命令入口都通过 `justfile` 暴露；V0 不安装全局 `sdcodex`。Codex hook capture命令只支持在shell-deck创建的Shell terminal内启动；普通外部terminal缺少Room runtime context时必须fail loudly，不产生unbound evidence。
* V0 MacroDefinition 的 terminal reference 只保存连续 index/type；terminalId/launchId 仅属于 live Room runtime，Start 时由 index 解析并冻结，definition 不保存 physical terminal id、alias、cwd 或 Room identity。
* terminal Prepare只允许用户点击Macro面板唯一的`Prepare terminals`按钮显式触发，消费当前visual/JSON draft的合法terminalLayout snapshot；Settings、Macro selection、Library Load、Save、Start与terminal event都不得隐式Prepare。
* 同一Room的共享mutation必须通过server-side controller guard；Macro/Library saved record编辑必须同时满足content edit lease与expected revision，client disabled state不承担正确性。
* Macro 与 Library 的 Copy 只表示把当前文本写入 clipboard；产品不提供 Duplicate、clone 或 copy-and-create。创建相似内容必须显式 New、Paste、Save，并走正常 validation 与 fresh record identity。
* V0持久化MacroRecord、macro run event log、artifact与只读evidence；Room、terminal、runner cursor和run snapshot只存在于live server process，restart后不从日志恢复。
* 前端使用 Svelte 5 写法；新增组件优先使用 runes。
* 真实 PTY 等价于本机 shell 能力。默认只绑定 `127.0.0.1`；LAN 暴露必须显式开启，并且后续必须设计访问控制。
