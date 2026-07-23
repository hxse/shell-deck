# Problem Context

## 当前问题

文件前段管理client identity、room/global client map、ping/pong和disconnect；后段管理control owner、epoch、grant/view、takeover与controlled operation ticket。两者通过明确事件关联：connect可能首次分配controller，disconnect/TTL可能释放controller，owner pong续期controller。

## 拆分选择

presence coordinator只拥有client lifecycle操作；controller lease coordinator只拥有`room.controller/controlEpoch` transition和authorization。两者不各建一份client/owner cache，而是通过同一map与显式callbacks组合。

原`RoomControlCoordinator`保留对manager的完整surface，使server production consumer不直接拼装两个子模块，也避免把cross-domain ordering散到manager。

## 风险边界

连接消息顺序、first-generation auto-control、takeover previous-owner hook、lost message与broadcast顺序必须完全不变。heartbeat sweep先expire controller再处理client ping；owner pong先刷新liveness/TTL，再broadcast并调用heartbeat hook。
