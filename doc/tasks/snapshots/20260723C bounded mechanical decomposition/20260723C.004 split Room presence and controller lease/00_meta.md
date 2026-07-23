# 20260723C.004 Split Room Presence and Controller Lease

## 任务概括

`server/roomControlCoordinator.ts`当前453行，把client connect/disconnect/ping/pong presence与controller epoch/lease/ticket transaction放在一起。本task拆成两个internal coordinator，原文件保持manager唯一入口和public re-export。

## 正式 task 级别及定级原因

三星任务。presence loss会撤销controller并释放content lease；takeover在await旧owner cleanup后必须重新检查Room lifecycle与new owner context。拆分错误会产生双controller或授权已失效mutation。

## 范围内

* 抽出Room client presence/heartbeat coordinator。
* 抽出controller lease/grant/view/ticket coordinator。
* 原`RoomControlCoordinator`组合二者并保持现有method/export。
* 二者访问同一Room/client map，不复制registry。

## 范围外

* 不改变WebSocket handshake、heartbeat/TTL常量、control protocol或error。
* 不改变TerminalRoomManager public API；其进一步facade拆分由`.006`承接。
* 不改变content edit lease hook业务。
