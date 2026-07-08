# 20260627A.021 Tab Capability Aware Macro Controls

* 父任务：`20260627A shell deck bootstrap`
* 状态：implementation-landed; automated gate passed
* 类型：post-v0 macro-editor-capability-implementation
* 前置任务：`20260627A.020 tab naming and macro target source labels`
* 目标：让 Macro Flow V2 编辑器根据所选 deck tab 的 backend capability 收窄可见控件和可选 action，避免 text tab 暴露 `terminal-quiet`、`terminal-buffer`、`agent-event` 等只适用于 shell/fake/real tab 的能力。
* 非目标：不修改 macro JSON 字段名；不把内部 `terminal` ref 改名为 `tab`；不改变 runner 已支持的 send/input/text append 行为；不做人工 smoke。
