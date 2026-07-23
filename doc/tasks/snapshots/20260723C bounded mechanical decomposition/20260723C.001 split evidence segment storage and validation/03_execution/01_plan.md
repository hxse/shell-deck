# Execution Plan

## 阶段一：冻结baseline

记录public export/method、落盘目录与bytes、error inventory、append/durability phase及现有failure injection。先补module/source boundary oracle，不改实现。

## 阶段二：抽record validation

移动exact event/summary/provenance codec和intent equality；Store继续决定调用时点。运行invalid record、idempotent append与summary unit。

## 阶段三：抽segment storage

移动append/recover/read/list/prune primitive，以显式receipt/path API返回结果。逐项核对write/fsync/hook/directory与prune顺序。

## 阶段四：收口

删除入口中的重复private实现，确认三文件均不超过400行、无cycle、无新consumer。运行focused durability、完整unit/integration相关组、check/build/diff-check，之后才写`04_review`。

## Legacy Kill List

只删除移动后留在`evidenceStore.ts`的重复codec/filesystem helper与无consumer private type；不删除任何public export、error或current schema reader。
