# Problem Context

用户需要自己选择 parser 输入来源。默认 terminal-buffer 最通用，但不可靠；AgentEvent 更干净，但依赖具体 agent adapter。

把 capture source 单独拆出来，可以避免 parser 任务同时承担 terminal buffer、HTTP ingest、hook adapter 和模型调用风险。
