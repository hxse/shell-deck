# Execution Plan

## 阶段一：冻结输出

1. 建立代表全部node/reference组合的characterization cases。
2. 记录三个public gateway和production consumers。
3. 对multi-issue与invalid JSON固定完整结果。

## 阶段二：抽基础层

先移动context/collector与primitive helpers；facade继续按原顺序调用，逐步删除原实现。

## 阶段三：抽node与reference

1. 移动结构递归，不改变遍历顺序。
2. 移动global/reference passes，不改变scope状态表达。
3. 移动text parser并复用同一facade pipeline。

## 阶段四：收口

确认内部模块单向依赖、production无旁路调用、原文件只保留公开pipeline。运行完整Gate并在review记录issue equivalence证据。
