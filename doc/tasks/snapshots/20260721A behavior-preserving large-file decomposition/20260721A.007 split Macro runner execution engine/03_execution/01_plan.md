# Execution Plan

## 阶段一：execution trace

为每种Flow/Action记录callback、await、checkpoint与event序列。补nested、cancel和fault-injection characterization，确认service的single-owner边界。

## 阶段二：pure evaluation与agent capture

先移动文本/artifact/template逻辑，再移动AgentEvent capture；保持service调用时点和错误映射。

## 阶段三：Action与Flow executor

1. 建立窄execution context/callbacks。
2. 移动Action dispatch并删除service旧branch。
3. 移动递归Flow traversal；所有lifecycle commit仍回调service。
4. 每步比较exact event/callback trace。

## 阶段四：收口

确认service仍是active run、input waiter、event和terminalization唯一owner。扫描重复state machine、直接Room lookup与吞cancel catch，运行完整runtime Gate。
