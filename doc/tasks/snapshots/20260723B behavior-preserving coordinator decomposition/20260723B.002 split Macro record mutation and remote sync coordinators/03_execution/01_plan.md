# Execution Plan

## 阶段一：baseline与ports

* 冻结factory return surface、rune variable owner、operation token和published Create branches。
* 运行invalidation、lease/durability与saved-content race baseline。
* 定义MutationWorkflow outcome与RemoteSync live snapshot/commit ports，不移动state。

## 阶段二：MutationWorkflow

* 先移动record/Library client proxy和fresh lease acquisition。
* 再移动persist/create/update/created-record lease transaction，保持每个await后的current guard。
* factory保留`persistDefinition`薄adapter，唯一应用lease与published-create outcome。
* 运行Save/Delete/JSON/Start/delayed Create focused Gate。

## 阶段三：RemoteSyncCoordinator

* 移动invalidation queue、serialized drain、read generation、connection/focus reconcile与retry timer。
* effects只把connection/content events转发给coordinator；mount/dispose只装配focus与release lease。
* factory通过live snapshot/commit callbacks继续唯一更新record/error/templates。
* 运行remote Save/Delete/reconnect race Gate。

## 阶段四：closeout

* 增加module-boundary/single-rune-owner断言，扫描generic session、duplicate old implementation与cycle。
* 运行static/build/full unit/integration和focused browser Gate。
* 同步active Macro contract、review/index，确认`jj conflict=false`后进入`.003`。
