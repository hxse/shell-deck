# Problem Context

## 当前问题

factory中约134-426行是navigation与CRUD command，445-638行是JSON/Start/persist/lease/operation guard。它们都通过同一组runes提交结果，但大部分await流程可以表达为“读取live snapshot -> 调用现有workflow -> 返回typed outcome -> factory校验并commit”。

## 拆分选择

保留factory作为唯一state machine owner，只把跨请求的步骤编排移到无rune模块。navigation负责list/select/new/load的请求与phase；edit orchestrator负责lease、persist/delete和published-Create outcome。JSON buffer与最终state install仍由factory控制。

现有`MacroRecordMutationWorkflow`继续负责transport/transaction，`MacroRecordRemoteSyncCoordinator`继续负责queue/retry；新模块不能复制它们。

## 风险边界

所有continuation必须复核operation generation、controller epoch、record identity/revision、draft/JSON revision和lease ID。Create已durable但后续lease取得失败时必须保留submitted buffer和fresh identity；不能重复Create，也不能把server truth覆盖到protected buffer。
