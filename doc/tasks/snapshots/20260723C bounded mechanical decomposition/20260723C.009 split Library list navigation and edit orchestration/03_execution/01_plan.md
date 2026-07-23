# Execution Plan

## 阶段一：baseline

冻结factory rune/return、NavigationCoordinator identity、search timer/list generation、protected-buffer state table和await guards。

## 阶段二：抽list/search

移动debounce、reload/list result phase；factory保留kind/search/items/status commit。运行list/search/navigation focused E2E。

## 阶段三：抽edit orchestration

移动lease/persist/delete/Cancel/Discard/Load request phase，复用现有MutationWorkflow与NavigationCoordinator；factory保留最终state install。

## 阶段四：收口

删除duplicate helper，确认无generic session、无state cache且各文件不超过400行。运行Library unit/integration/全部Library E2E与Macro Load场景、check/build/diff-check，之后写`04_review`。

## Legacy Kill List

删除factory中迁移后的duplicate list/edit orchestration；保留全部runes、public return、existing coordinators、feedback与current Library contract。
