# Execution Plan

## 阶段一：Trace 与 storage path

让`EvidenceStore.page()`进入现有freshness gate，补cold direct request及warm range-only I/O测试。Trace index改从canonical User Data Root paths解析`.locks`，测试旧`locks/`不再出现。

## 阶段二：Room registration

把upgrade冻结的generation沿`roomWebSocketTransport -> TerminalRoomManager -> RoomControlCoordinator -> RoomClientPresenceCoordinator`传递。presence在mutation前比较generation；controller coordinator提供只针对本次fresh assignment identity的rollback closure。补generation mismatch和mid-registration send failure测试。

## 阶段三：Content lease

抽取acquire/takeover共用的post-publish authorization/track阶段。授权失败时使用同一record transaction按exact held-state identity回滚并发布available view。补acquire与takeover回归。

## 阶段四：File-size advisory与文档同步

scanner新增350行advisory结果与稳定formatter，400行issue逻辑不变。更新相关active specs、focused recipe、默认unit discovery和task index。

## 阶段五：串行验证与审阅

按顺序运行：

1. `just test-20260725b`
2. `just check`
3. `just build`
4. `just test-unit`
5. `just test-integration`
6. `just test-e2e`
7. `just diff-check`

每条命令结束后才启动下一条。随后核对change diff、全仓旧`/locks/trace-index.lock`痕迹、文件行数、current docs和jj conflict状态，并写`04_review`。

## Legacy Kill List

* `EvidenceStore.page()`绕过Trace freshness marker的读取；
* WebSocket open注册后才比较generation的post-mutation guard；
* registration失败只删client map、不撤销provisional controller的路径；
* acquire/takeover post-authorization失败留下untracked held lease的路径；
* `<User Data Root>/locks/trace-index.lock`；
* 只有400行hard failure、没有350行early signal的scanner结果。
