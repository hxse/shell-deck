# 20260723C.003 Split Content Edit Lease State Persistence

## 任务概括

`server/contentEditLeaseService.ts`当前467行，把lease acquire/takeover/renew/release/commit transaction与state-file path、exact codec、read/write/delete放在同一class。本task把后者抽成专用state store，业务service继续拥有authorization与owned lease truth。

## 正式 task 级别及定级原因

三星任务。lease transition与record mutation共享canonical transaction；record publish之后state refresh失败必须返回authoritative success而不是反转业务提交。拆分若移动authorization或publish boundary会破坏single-editor正确性。

## 范围内

* 新建lease state persistence/codec模块。
* service保留全部public API、owned map、controller context与business transaction。
* exact schema、state path、TTL/epoch、record revision读取和failure mapping保持。
* 相关文件均不超过400行。

## 范围外

* 不改变content resource key、HTTP、Macro/Library consumer或WebSocket notification。
* 不改变lease TTL、renew authority、takeover confirmation或expected revision。
* 不增加in-memory fallback、dual schema或自动修复invalid state。
