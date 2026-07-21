# Problem Context

真实run在`05:34:13`进入AgentEvent Capture，约10分钟后以`agent_event_not_ready`失败；相同Room、terminal、launch、Codex session与turn的Stop hook在`05:58:53`才到达。Hook与匹配完全正常，唯一原因是`MacroRunnerService`内部隐藏的`600_000ms`默认上限。

简单增大环境变量仍会在更长任务上失败，让For吞错也会使后续artifact consumer失败。正确边界是：等待策略属于Macro definition，默认无限等待；用户需要资源边界时才显式配置timeout。等待期间server仍是唯一状态owner，关闭browser不影响run，Stop可以随时取消。
