# Execution Plan

## 阶段一：V5 hard cut

1. 定义AgentEventWaitLimit并把agent-event capture改为required exact field。
2. 将production类型、validator、store、runner、Macro/Library gateway统一切换V5。
3. 机械更新current fixtures；V4只保留在明确的rejection test和历史snapshot/031B。

## 阶段二：Visual/JSON UI

1. root与Parallel lane默认factory写unbounded。
2. 增加Enable timeout与duration控件，保证branch原子切换。
3. JSON与Library只消费V5，不增加normalizer。

## 阶段三：runner

1. 删除隐藏环境变量和固定10分钟fallback。
2. 按waitLimit执行unbounded或active-time timeout。
3. 将baseline之后的matching agent.error转为稳定runtime failure。
4. 保持Stop/Pause/Destroy、late event和new-run baseline语义。

## 阶段四：Gate与收口

1. 增加schema、runtime、UI确定性测试，不运行真实Codex。
2. 更新active specs、README/guide和task review。
3. 让Macro与Library Macro JSON list统一隔离invalid saved content并显示identity diagnostic，不增加旧schema reader。
4. 扫描V4 production、missing waitLimit fallback与隐藏timeout env。
5. 运行完整Gate，自我审阅后将20260721A整条change链重基到.038。
