# Execution Plan

## 阶段一：baseline

冻结controller return、notice/confirm、policy output、成功与失败路径mutation before/after和component structure；特别记录terminal adoption/lane重查顺序及missing-action rename的旧返回语义，增加pure/stateful ownership test。

## 阶段二：抽policy

移动lookup/output/capability/choice函数，改为显式参数纯函数。运行terminal capability与artifact choice unit。

## 阶段三：抽commands

移动definition mutator并返回structured result；controller继续包裹唯一`updateDraft`、notice/confirm和collapse reconciliation。

## 阶段四：收口

删除duplicate pure helper，确认no draft cache、DOM/consumer不变且各文件不超过400行。运行Macro flow/layout/comprehensive E2E、check/build/diff-check，之后写`04_review`。

## Legacy Kill List

删除stateful controller中的duplicate lookup/command实现；保留全部rune、ports、return、notice/confirm和current mutation gateway。
