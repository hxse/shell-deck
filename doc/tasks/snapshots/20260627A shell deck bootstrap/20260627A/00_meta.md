# 20260627A Shell Deck V0 Blueprint

## 任务概括

创建 `shell-deck` 项目入口和 V0 蓝图，把产品方向从 `orch-web` 的 role / Codex orchestration 路线切换到 terminal-first macro automation。父任务只冻结总边界和阶段拆分；具体实现 contract 下沉到九个 V0 子任务。

## 正式 task 级别及定级原因

三星任务。

本任务决定新项目的产品语义、实现阶段和不可迁移边界。它不直接实现代码，但会约束后续所有子任务，防止系统重新滑回 role、hook-driven background loop、Codex session binding 或不可观测后台 loop。

## 范围内

* 创建 `<shell-deck-root>` 项目协作入口和 task 文档入口。
* 冻结 V0 蓝图：terminal deck、`just codex` temporary hook adapter and AgentEvent capture、visual macro panel、append-only run log、regex/ai-json parser soft signals、macro state recovery。
* 拆分 V0 阶段任务：v0 api probe、terminal deck foundation、macro template workbench、run log and artifacts、macro runner state machine、capture source and agent event adapters、parser profiles and adapters、bounded parallel lanes、V0 closeout。
* 明确 `orch-web` 只作为 terminal/PTY/multi-tab sync/input latency stabilization 的经验来源。
* 明确 legacy kill list：role、sealed instruction、caller proof、Codex launcher、blocking role operation API。

## 范围外

* 不实现前后端代码。
* 不初始化依赖、构建脚本或测试 runner。
* 不接入 OpenAI API 或真实 `ai-json` parser 实调用。
* 不绑定、不发现、不恢复 Codex session。
* 不创建 frozen active spec；子任务通过 Gate 并实现收口后再同步 active specs。
