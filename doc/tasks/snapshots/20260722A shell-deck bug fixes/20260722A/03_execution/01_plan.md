# Execution Plan

## 阶段一：建立修复队列

每批问题先从current源码与active spec确认真实行为和owner，再确定是否属于同一子任务；仅凭文件邻近不合并问题。

## 阶段二：逐子任务实施

为子任务创建formal docs和独立jj change，先补能证明问题的focused test，再完成最小实现与必要spec同步。

## 阶段三：自审与回归

逐项对照用户问题、Added/Frozen Semantics和negative boundary；执行focused/full Gate，检查worktree scope与legacy residue，修复明显错误后才结束该子任务。
