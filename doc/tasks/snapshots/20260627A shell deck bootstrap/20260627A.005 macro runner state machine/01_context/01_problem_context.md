# Problem Context

宏的核心价值是可暂停、可恢复、可人工接管。runner 必须建立在 event log 之上，而不是维护一套隐藏状态。

本任务故意不接真实 hook 或 Spark，先证明状态机和 UI 追溯闭环可靠，再把真实 capture source 和 parser 接进来。
