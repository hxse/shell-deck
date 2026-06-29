# Problem Context

宏运行必须高度可观测。用户和 AI 都需要从同一份日志追溯每一步发生了什么、输入是什么、输出是什么、为什么暂停或失败。

如果先写 runner，再补日志，很容易变成不可追溯后台状态机。因此 V0 先把 event log 和 artifacts 独立交付，再在后续任务把 runner 建在这层之上。
