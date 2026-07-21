# Review Result

## 当前状态

`20260721A.001`实现与自审完成。`server/httpServer.ts`现只保留service构造、显式route group顺序、listener/WebSocket装配、heartbeat、terminal env、shutdown与CLI lifecycle；HTTP与Room WebSocket实现已移入注入既有service的模块。重基到`.038`后，新模块统一消费MacroDefinitionV5并保留AgentEvent exact wait limit；没有HTTP/WebSocket contract、authorization、storage、UI或schema变化。

## 实际代码映射

* `server/http/httpContext.ts`：集中声明request共享的显式service context与`Response | null` route结果；不创建或缓存state。
* `server/http/httpPrimitives.ts`：原样承接body/query/header解析、revision校验、JSON/405/HTML响应与stable error mapping。
* `server/http/pageRoutes.ts`：承接built asset、Home redirect/index和Room page；模块目录下的asset/index resolve增加一层`..`以仍指向仓库原`dist`与`index.html`。
* `server/http/roomRoutes.ts`：承接health、Room list/create/destroy、controller acquire/take-over/release和Room-scoped AgentEvent ingest。
* `server/http/contentRoutes.ts`：承接content lease、Macro/Library CRUD/Load及Macro相关只读catalog endpoints；record transaction、`ticket.assertAuthorized()`、publish后broadcast与lease outcome顺序未改。
* `server/http/runnerRoutes.ts`：承接Prepare、runner snapshot/traces、Start、Pause/Resume/Stop和runtime input；terminal structure operation与authorization复核边界未改。
* `server/roomWebSocketTransport.ts`：承接upgrade匹配、client registration、initial Room/runner snapshot、message dispatch、backpressure drain、pong和disconnect/terminate cleanup。
* `server/httpServer.ts`：按`Room -> content -> runner -> API 404 -> page`显式组合。三组API route match集合互不重叠；组内保留`from-library`早于template-id、lease action早于lease-id、traces早于runner action等原有重叠优先级。
* `tests/unit/httpRoutingTransport.test.ts`：冻结JSON/405/error serialized response、strict body error、route group显式decline和composition root顺序。

## 自审结论

* P1：0。
* P2：0。
* P3：0。
* AI直接修：初版抽取后恢复WebSocket `RoomSummary`显式类型，并补transport primitive与route-order regression。
* 需要用户拍板：无。

逐项核对确认URL/method/status/body/header/error string只有唯一实现；WebSocket upgrade仍早于HTTP routing，invalid `/ws*`仍返回JSON 404；API fallback仍早于asset/page fallback。controller/content lease ticket、published-operation、Prepare structure lock、runner preflight与Room destroy/AgentEvent逻辑均只移动文件，handler内部statement和`await`顺序保持。service/store未反向import HTTP模块，route groups彼此无import，未引入router/DI framework、singleton、compatibility或第二套入口。

## Gate结果

* `just check`：通过，TypeScript与Svelte均为0 error / 0 warning。
* `just build`：通过，188 modules transformed。
* `just test-unit`：重基到`.038`后通过，152 unit与53 integration，0 fail；integration包含Room/controller/content lease/published-operation/runner/WebSocket/real PTY及AgentEvent wait-limit全套现有回归。
* `just test-e2e`：最终完整重跑48项Chromium E2E全部通过，覆盖Room双标签、single-controller、37 MB PTY/replay、Macro/Library/runtime sync及AgentEvent wait-limit UI。
* `just debug-large-replay`：原实现阶段focused通过；重基后的完整48项E2E也包含同一37 MB journey并通过，未修改断言或产品代码。
* `git diff --check`、反向HTTP import、duplicate handler及`.orig/.rej`扫描：通过。

## 文档同步

本任务只改变内部源码归属，active specs中的URL、Room/WebSocket、controller、lease、runner和storage contract均未变化，因此不改写`doc/tasks/active_specs/**`；本review与task index记录新的实现边界。
