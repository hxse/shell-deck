# Execution Plan

## 阶段一：characterization

1. 列出`httpServer.ts`全部HTTP/upgrade分支及实际优先级。
2. 将每条route映射到现有integration/E2E；为未覆盖的相邻route与authorization时点补测试。
3. 记录server bootstrap与shutdown ownership。

## 阶段二：transport extraction

1. 先抽无state的HTTP primitives与显式context类型。
2. 抽Room WebSocket transport，保持manager callback和cleanup顺序。
3. 每步删除入口内重复实现并运行focused Gate。

## 阶段三：route groups

按page、Room、content、runner逐组移动。每组保持原handler statement/await顺序，由`httpServer.ts`显式串联匹配顺序。

## 阶段四：收口

1. 确认入口只剩bootstrap/composition/lifecycle。
2. 扫描duplicate handlers、hidden singleton、反向import和新增compatibility。
3. 运行完整Gate并在`04_review`记录route inventory与测试证据。
