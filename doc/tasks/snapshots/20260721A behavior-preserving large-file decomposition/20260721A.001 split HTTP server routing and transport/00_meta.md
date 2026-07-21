# 20260721A.001 Split HTTP Server Routing And Transport

## 任务概括

拆分`server/httpServer.ts`的职责，让server入口只负责依赖创建、listener生命周期、顶层route顺序和shutdown；具体HTTP handler与Room WebSocket transport进入小模块。拆分前后所有请求、响应、事件和授权时点必须等价。

## 正式 task 级别及定级原因

三星任务。

HTTP入口连接Room lifecycle、controller grant、content store、runner、filesystem和WebSocket。移动顺序或await边界可能导致已发布写入被误报失败、authorization竞态或错误route抢占，因此需要完整integration与forced-interleaving Gate。

## 范围内

* 拆出HTTP context、response/error primitives和route handler组。
* 拆出Room WebSocket upgrade、client registration、snapshot/event delivery与disconnect清理。
* 保留`httpServer.ts`作为唯一bootstrap与route-order composition root。
* 为handler注入现有services，不在模块内创建隐藏singleton。

## 范围外

* 不改变任何URL、method、status、body、header、error code或WebSocket message。
* 不改变controller/content lease、published-operation、Room lifecycle或storage contract。
* 不引入router framework、dependency injection framework或第二套server入口。
* 不调整前端调用与协议类型。
