# AGENTS.md - shell-deck 协作入口

本项目遵循 `<pyo3-quant-root>/AGENTS.md` 的文档和审阅规范。当前设计真值在正式 task 通过 Gate 前以 `doc/tasks/snapshots/**/02_spec/**` 为准；实现收口后再同步到 `doc/tasks/active_specs/**`。

## 当前项目目标

`shell-deck` 是一个 terminal-first macro automation 工作台。它提供浏览器多 tab 同步终端、一个 deck 内多个 terminal slot，以及可视化 macro panel，用可暂停、可追溯、可恢复的宏模板编排终端输入、等待、capture source、Spark parser 解析和分支。默认 capture source 是 terminal-buffer 原始 TUI 截取，也支持 AgentEvent/Codex hook capture。

## 工作方式

* 全程中文沟通，关键技术术语保留英文。
* 当前项目焦点只看 `shell-deck` 自己的源码和文档；`orch-web` 只作为 terminal 底座经验来源，不再作为产品方向真值。
* 新正式任务必须先写 task 文档，结构遵循 `doc/tasks/` 分层。
* 查询当前真值时优先看源码和 `doc/tasks/active_specs/**`；若 active spec 尚未冻结，则看当前 task 的 `02_spec/**`。
* 默认采用 current-schema-only 的破坏性演进：不兼容旧语法、不读取或处理旧语法，优先直接替换旧 contract；不得添加 alias、migration、dual schema、legacy branch 或自动转换。旧输入必须按当前 schema fail loudly。只有用户在具体 task 中明确要求兼容时才可例外，并必须把兼容边界冻结到该 task 的 `02_spec/**`。
* 审阅报告按 P1/P2/P3 分级，并区分“AI 直接修”和“需要用户拍板”。
* 不把 `orch-web` 的 role / Codex orchestration 默认迁移过来；只有 terminal/PTY/multi-client sync 等被当前 spec 明确保留的底座能力才进入 `shell-deck`。

## 技术边界

* V0 编排 terminal，不编排 Codex。Codex 只是用户可能在 terminal 中运行的程序之一。
* 所有 shell-deck 项目命令入口都通过 `justfile` 暴露；V0 不安装全局 `sdcodex`，Codex hook capture 通过 `just -f <shell-deck-root>/justfile -- codex <codex args...>` 启动。
* V0 macro template 可以引用动态 terminal index、稳定 terminal id 或 alias，但不绑定 Codex session。
* V0 持久化 macro template、macro run event log 和 macro state；不自动恢复第三方 session。
* 前端使用 Svelte 5 写法；新增组件优先使用 runes。
* 真实 PTY 等价于本机 shell 能力。默认只绑定 `127.0.0.1`；LAN 暴露必须显式开启，并且后续必须设计访问控制。
