# Problem Context

## 当前问题

factory约三分之一是`handleMessage`分支，另一部分是close/reconnect/reclaim timer；terminal commands和rune declarations反而较清晰。message routing依赖live generation/revision和commit callbacks，但不需要自己拥有Svelte state。

## 拆分选择

message coordinator接收每次调用时的live identity与细粒度commit ports，按原顺序处理消息。reconnect coordinator负责close probe、750ms retry和reload controller intent的5秒窗口，并让factory决定何时写`connected/client/controlView` runes。

不把两者做成第二个`createRoomWorkspaceState`，也不把全部state装进plain object后双向同步。

## 风险边界

connection effect每次generation重置terminal/revision/runner/content/notification的顺序必须不变。旧Room generation消息必须被丢弃；Room Destroy必须本地进入Home而不请求root route；close probe成功且Room仍live或network exception才schedule reconnect，HTTP非成功或body `ok`为false继续直接返回。拆分不得顺手修正这组父版本失败语义或给control acquire增加新的continuation guard。
