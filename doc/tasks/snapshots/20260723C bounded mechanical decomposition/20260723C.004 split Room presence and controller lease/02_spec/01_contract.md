# Formal Contract

## 任务边界

允许新增`roomClientPresenceCoordinator.ts`和`roomControllerLeaseCoordinator.ts`或等价命名。`roomControlCoordinator.ts`继续导出heartbeat constants、`RoomControlledOperationTicket`与原class methods；`TerminalRoomManager`仍只消费该facade。

## 任务规范

### 单一state

* `rooms`、global `clients`与每个Room `clients` map仍是同一组reference。
* presence不缓存controller；lease不复制client。
* `room.controller`与`controlEpoch`只有lease coordinator可转换。

### Presence/heartbeat

* client ID collision最多重试8次，注册失败回滚两个map。
* connect发送顺序保持`client_registered`、control expiry/assignment or view、`room_snapshot`。
* fresh Room第一个完成connect的client仍自动controller；available Room中的ordinary reconnect不自动提升。
* disconnect先从global/Room map移除，再按是否owner触发release。
* pong刷新client liveness；只有current owner续controller TTL、广播并调用heartbeat hook。
* sweep保持TTL、ping、4002 close code/reason及failed ping cleanup。

### Controller lease/ticket

* acquire/takeover/release的epoch、confirmation、context与error语义不变。
* takeover在assign new owner后调用old-owner lost hook；await后必须检查lifecycle active与new context仍authorized，再通知old client并broadcast。
* controlled ticket继续同时绑定Room lifecycle与control context。
* ordinary controlled operation在await后再次authorization；published operation只在进入前验证，不能把已发布durable commit反转成失败。
* expiry/disconnect/lost hook与control state broadcast最多按原路径触发一次。

## 示例

正例：takeover已写入new owner，等待old-owner lease cleanup期间Room被Destroy。continuation必须因lifecycle失效停止，不能再发送control message或返回grant。

正例：published content commit完成后control转移。operation返回authoritative success；ticket只finish，不做post-await authorization。

反例：presence coordinator维护`currentControllerClientId` cache，或lease coordinator直接拥有第二个client map，均阻断。

## 测试

* `roomControl033.test.ts`冻结auto owner、TTL、takeover、published operation和destroy race。
* `terminalRoomManager032`、WebSocket/singleWriter integration与takeover E2E冻结connect/disconnect/pong和message顺序。
* `contentEditLease033`冻结lost/heartbeat hooks。
* 新增module consumer、single map与no duplicate control transition oracle。
* 正式Gate：`just check`、build、focused unit/integration/E2E、`just diff-check`；本轮未执行。
