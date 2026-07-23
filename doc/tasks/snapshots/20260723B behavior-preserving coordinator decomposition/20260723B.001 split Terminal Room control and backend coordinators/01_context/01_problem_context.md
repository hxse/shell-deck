# Problem Context

## Current evidence

`server/terminalRoomManager.ts`为1158行。public control plane集中在235–499行，terminal backend mutation在518–714行，control private helpers在852–961行，backend callback/cwd/broadcast helpers在1017–1138行。manager被server与tests广泛消费，因此改变公开class会扩大无关迁移面。

## Ownership问题

Room registry与RoomRuntime本身只需要一个owner，但当前同一class还直接实现两套相对独立的state machine：

* control coordinator：client registration、personalized control view、lease epoch/TTL、takeover cleanup、controlled ticket admission。
* backend coordinator：terminal candidate start、pending synchronous callbacks、commit后publish、launch/generation filtering、replay/revision、cwd refresh与close drain。

把二者拆出并不意味着复制state。新模块必须通过manager提供的Room lookup/admission/broadcast ports操作同一`RoomRuntime`对象；manager仍是所有外部consumer看到的唯一facade。

## 主要风险

* connect时`client_registered → room_control → room_snapshot`顺序改变。
* takeover在旧owner cleanup后漏掉lifecycle/context recheck。
* published operation错误增加post-commit authorization。
* backend `start()`同步回调在candidate commit前被提前broadcast。
* reset关闭旧backend的flush与新snapshot/new output顺序改变。
* stale launch/generation callback污染current terminal。
* cwd debounce或destroy漏清timer/backend promise。
