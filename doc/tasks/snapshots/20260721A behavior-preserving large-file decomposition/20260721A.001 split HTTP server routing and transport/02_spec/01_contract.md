# Contract

## 任务边界

### Added Semantics

无。

### Frozen Semantics

* 全部现有HTTP URL、method、query/path decode、content type、status、body与stable error冻结。
* route匹配优先级、404/405行为、body size/JSON parse行为和static asset fallback冻结。
* Room generation、controller bearer、content lease、expected revision、structure lock与published point-of-no-return检查顺序冻结。
* WebSocket upgrade path、initial snapshot、message ordering、heartbeat、reconnect与disconnect cleanup冻结。
* server bind、LAN opt-in、start/stop、signal与notification config行为冻结。

### Primary file

`server/httpServer.ts`。

必要的直接调用适配可修改相邻test/import，但不得改变service实现。

## 任务规范

### 目标模块

* `server/http/httpContext.ts`：只定义每个request共享的显式service/context，不拥有state。
* `server/http/httpPrimitives.ts`：request parse、JSON/text response和既有error mapping pure transport helpers。
* `server/http/pageRoutes.ts`：Home、Room page与built asset响应。
* `server/http/roomRoutes.ts`：Room registry/lifecycle、terminal/controller HTTP routes。
* `server/http/contentRoutes.ts`：Macro、Library与content lease HTTP routes。
* `server/http/runnerRoutes.ts`：Prepare、Start、Pause/Resume/Stop、runtime input与Trace routes。
* `server/roomWebSocketTransport.ts`：Room socket upgrade、client lifecycle与server event forwarding。
* `server/httpServer.ts`：配置读取、service构造、listener、严格route group顺序、WebSocket装配与shutdown。

最终文件名允许实施时按仓库命名约定微调，但职责和依赖方向不得改变。

### 依赖方向

`httpServer.ts -> route groups -> services/store`。route groups可依赖`httpContext`和`httpPrimitives`，彼此不得互相import；service/store不得反向依赖HTTP模块。

### 移动规则

* 每次只迁移一个route group，并保持handler内部statement/await顺序。
* authorization ticket和`beforeCommit` guard不得被抽成泛化middleware而改变时点。
* published-operation success reconciliation保持在原transaction边界。
* route group返回明确`handled/not handled`，顶层顺序必须可读且可测试；不得依赖exception表示“不匹配”。
* 删除原入口内对应实现，禁止wrapper与旧handler双存。

## 示例

### 合法

`contentRoutes.handle(request, context)`沿用原Macro Create路径：parse → controller admission → store transaction内beforeCommit复核 → authoritative response/broadcast。只是代码归属改变。

### 非法

* 把所有guard放进统一middleware，导致record lock等待后不再复核controller。
* 让page fallback早于API 404，返回HTML而不是原JSON error。
* WebSocket模块自行创建新的Room manager实例。

## 测试

### 静态与单元

* import graph无route group cycle，service层不反向依赖HTTP。
* route registry顺序有明确oracle。
* response/error primitive保持原serialized bytes与status。

### Integration

* 现有Room、terminal、Macro、Library、runner、lease和published-operation suites原样通过。
* 覆盖相邻/未知URL、method mismatch、invalid body、stale bearer、takeover和Destroy竞态。
* WebSocket initial snapshot、event ordering、disconnect/reconnect和Room generation测试原样通过。

### Gate

`just check`、`just build`、全部HTTP/integration tests、相关Room双标签E2E与`git diff --check`通过。diff审阅必须证明除模块/import移动外没有contract变化。
