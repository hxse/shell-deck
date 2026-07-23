# 20260723B.002 Split Macro Record Mutation and Remote Sync Coordinators

## 任务概括

`macroRecordSession.svelte.ts`继续作为每个Macro panel实例唯一的selection/draft/lease/rune state owner，但把record/lease网络事务与remote invalidation/reconnect decision loop分别移入两个Macro-specific模块。

## 正式 task 级别及定级原因

三星任务。

该session约926行并包含saved-content race、fresh lease、operation identity、published Create preservation、JSON/visual双revision、remote invalidation与bounded retry。错误可能让已提交record丢失identity、让remote truth覆盖dirty buffer或让stale response误提交。

## 范围内

* 新增`macroRecordMutationWorkflow.ts`，负责Macro record/Library mutation、fresh lease与persist transaction的异步编排，并返回显式outcome。
* 新增`macroRecordRemoteSyncCoordinator.ts`，负责Macro invalidation queue、serialized drain、connection/focus reconcile与bounded retry。
* factory继续唯一声明和写入全部`$state`；coordinator通过read/commit ports读取live state并把结果交回factory提交。
* public `MacroRecordSession` return surface、MacroPanel/runner consumer和全部文案/interaction不变。

## 范围外

* 不建立Macro/Library共享的`GenericContentSession`或feature flag。
* 不把rune state移入module singleton、global store或第二个owner。
* 不改变MacroDefinitionV5、record API、content lease、Library Save、Start、JSON、DOM或UI presentation。
