# Execution Plan

## 阶段一：contract与focused failure

先更新App channel type/default/strict validator及fixtures，补notification browser scheduler测试；同时为现有UI缺口建立focused browser断言。

## 阶段二：authoring UI

实现text-list index插入与icon；压缩template token controls并删除source hint；用既有Parallel final Output/source:none映射轻量checkbox，不修改schema/runtime。

## 阶段三：run lock与stage

把active runner status接入Macro selector、visual/JSON editability和defensive mutation guard；建立统一read-only notice。Run dock从frozen definition解析current stage，把currentNodeId下传到flow/Parallel card做高亮。

## 阶段四：notification delivery

把repeat字段透传到Room protocol；browser在一次dedupe后调度App呈现并管理timer cleanup，保持System/Telegram一次语义。

## 阶段五：自审与Close Gate

逐项检查DOM、schema、timer lifecycle与终态解锁，运行focused及完整Gate；同步active spec、task review和index，未解决P1/P2时不得结束。
