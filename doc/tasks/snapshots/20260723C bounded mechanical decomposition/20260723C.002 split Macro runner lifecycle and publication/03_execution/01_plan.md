# Execution Plan

## 阶段一：baseline

冻结public surface、`LiveRun`字段、status/event/error inventory，以及Start/finish/Input/publication的调用顺序。增加static consumer与single-state oracle。

## 阶段二：publication与interaction

先抽snapshot/delta projection和timer，再抽Pause/Resume/checkpoint/Input。两者只接收current live object及append/publish callbacks；每一步跑runner snapshot与input focused tests。

## 阶段三：lifecycle与facade

移动Start/execute/finish/destroy orchestration；service只保留public validation/dispatch和dependency wiring。核对structure lock和durable publish fault injection。

## 阶段四：收口

删除重复private methods，确认无cycle、无state mirror且各文件不超过400行。运行Macro runtime unit/integration、Room runner/Input E2E、check/build/diff-check，之后写`04_review`。

## Legacy Kill List

清理service中已迁移的duplicate lifecycle/interaction/publication实现和临时ports；保留全部public method、status、event与error contract。
