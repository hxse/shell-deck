# 20260627A.014 Macro Prompt Workbench UI Cleanup

* 父任务：`20260627A shell deck bootstrap`
* 状态：implementation-landed；automated gate passed
* 类型：workspace-ui-cleanup
* 目标：清理 .013 后暴露的 Macro / Prompt / Run Log 信息架构问题，把模板选择、prompt 选择、runner controls、Run Log / AI Trace 和实时刷新整理成可交付的工作台 UI；同时把 terminal tab close 作为本轮 workbench chrome cleanup 的小功能显式纳入范围。
* 非目标：不实现 Flow V2 compiler/interpreter；不改变 macro runner 执行语义；不新增 prompt 自动发送、变量替换或版本历史。
