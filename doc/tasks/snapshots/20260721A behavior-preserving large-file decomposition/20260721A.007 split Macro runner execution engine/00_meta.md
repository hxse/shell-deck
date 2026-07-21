# 20260721A.007 Split Macro Runner Execution Engine

## 任务概括

拆分`server/macroRunnerService.ts`的递归Flow解释、Action执行、message/template求值和AgentEvent capture。MacroRunnerService继续是run lifecycle唯一owner，负责Start admission后的install、Pause/Resume/Stop、runtime input、exactly-once terminalization、durable evidence和Room snapshot/delta publish。

## 正式 task 级别及定级原因

三星任务。

runner同时处理异步terminal I/O、pause/cancel、forever cooperative yield、input resolver、artifact scope和durable event point-of-no-return。错误边界会额外发送Enter、卡死structure lock、产生冲突终态或破坏Trace。

## 范围内

* 抽取递归Flow executor。
* 抽取单Action runtime dispatch与terminal operation adapters。
* 抽取message/template/artifact求值。
* 抽取Room-scoped AgentEvent capture逻辑。
* 保留service lifecycle、event append、snapshot/delta与active run registry。

## 范围外

* 不改变Action/Flow语义、MacroDefinitionV5、AgentEvent exact wait-limit或Start validation。
* 不改变event taxonomy/order、bounded durable tail、artifact或Trace contract。
* 不改变pause/stop/destroy/input/cancellation与terminal structure lock。
* 不新增worker、parallel scheduler或run persistence/recovery。
