# Execution Plan

## 阶段一：baseline

冻结component structure fingerprint、script state/handler inventory、anchor command before/after及browser focus/viewport行为。

## 阶段二：建立controller

移动insertion runes、anchor factories、validity、palette delegate和insert/move commands；通过live getters消费draft/mode。

## 阶段三：thin wiring

component只绑定controller getters/methods，markup和recursive snippet逐字保持。先跑source/structure，再跑browser interaction。

## 阶段四：收口

删除component duplicate handler，确认lifecycle算法唯一、no draft cache且component/controller均不超过400行。运行Macro flow/layout/comprehensive E2E、check/build/diff-check，之后写`04_review`。

## Legacy Kill List

删除component中迁移后的duplicate insertion state/commands；保留exact markup、render adapters、tree controller与existing palette lifecycle。
