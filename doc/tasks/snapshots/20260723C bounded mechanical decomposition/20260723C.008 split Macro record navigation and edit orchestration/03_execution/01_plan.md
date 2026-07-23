# Execution Plan

## 阶段一：baseline

冻结factory rune/return/function inventory、operation token字段、await后guard和published-Create state table；补no-rune/no-cache/module consumer test。

## 阶段二：抽navigation

移动list/select/new/load request phase与typed outcome，factory保留confirm、state install和UI feedback。运行navigation/dirty/reconnect E2E。

## 阶段三：抽edit orchestration

移动begin/cancel/persist/delete/lease phase，复用现有MutationWorkflow；factory保留JSON/Start integration、operation token和commit。

## 阶段四：收口

删除duplicate command helper，确认return/DOM/text不变、无generic session且各文件不超过400行。运行Macro unit/integration/saved-content/comprehensive E2E、check/build/diff-check，之后写`04_review`。

## Legacy Kill List

删除factory中迁移后的duplicate navigation/edit orchestration；保留全部rune、public return、MutationWorkflow/RemoteSync和current feedback/error。
