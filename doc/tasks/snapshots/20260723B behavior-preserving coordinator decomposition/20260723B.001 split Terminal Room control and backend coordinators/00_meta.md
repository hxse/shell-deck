# 20260723B.001 Split Terminal Room Control and Backend Coordinators

## 任务概括

继续完成`20260721A.008`的薄facade目标：`TerminalRoomManager`保留唯一公开class、Room registry/lifecycle composition、structure mutation gateway和跨域wiring；Room control与terminal backend lifecycle分别移动到两个内部coordinator。

## 正式 task 级别及定级原因

三星任务。

该移动不改功能，但覆盖controller lease/heartbeat/takeover、controlled operation ticket、PTY synchronous start callback buffering、launch generation guard、cwd debounce与Room destroy drain。任一await或publish顺序漂移都可能产生quietly wrong状态。

## 范围内

* 新增`server/roomControlCoordinator.ts`，拥有client/heartbeat/controller/ticket协调。
* 新增`server/terminalBackendCoordinator.ts`，拥有terminal create/input/text/resize/reset/close、backend callback、replay/runtime revision与cwd refresh。
* `TerminalRoomManager`继续暴露全部既有method/type/constant，并以private coordinator委托。
* `rooms`与`clients` map仍由manager创建并只保存一份；coordinator只持有相同引用/ports。
* destroy、broadcast、Room lookup、structure queue与public consumers保持原边界。

## 范围外

* 不改变protocol、message order、error string、ID generation、Room/terminal state shape或backend interface。
* 不移动runner/content lease调用方，不让production consumer直接import内部coordinator。
* 不引入shadow registry、event bus、second queue、compatibility layer或generic service framework。
