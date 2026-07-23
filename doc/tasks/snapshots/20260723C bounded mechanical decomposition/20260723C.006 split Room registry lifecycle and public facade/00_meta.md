# 20260723C.006 Split Room Registry Lifecycle and Public Facade

## 任务概括

`server/terminalRoomManager.ts`当前485行，已经把control/backend移出，但仍直接实现Room ensure/create/list/summary/lookup/generation/destroy，同时代理完整terminal/control API。本task抽出Room registry/lifecycle coordinator，manager继续是唯一公开class与composition root。

## 正式 task 级别及定级原因

三星任务。Room destroy必须先关闭admission/abort，再drain ticket、hook、PTY和client，最后移除registry；route lazy-create与capacity也必须原子共享同一map。错误会导致Room复活、generation串线或资源泄漏。

## 范围内

* 新建Room registry/lifecycle coordinator。
* manager继续创建并公开同一`rooms/clients` map reference，保留全部public API/re-export。
* coordinator承接create/list/lookup/generation/destroy orchestration。
* manager保留control/backend/structure composition与broadcast wiring。

## 范围外

* 不改Room URL、capacity、identity、terminal mutation或control/backend内部。
* 不把public consumers改为直接依赖coordinator。
* 不增加persistent Room registry或restart recovery。
