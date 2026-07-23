# 20260723B.003 Split Library Mutation and Remote Sync Coordinators

## 任务概括

`librarySession.svelte.ts`继续作为每个Library panel实例唯一的kind/search/selection/draft/lease/rune state owner，并继续使用现有`LibraryNavigationCoordinator`冻结operation identity；record/lease网络事务与remote invalidation/reconnect decision loop分别移入两个Library-specific模块。

## 正式 task 级别及定级原因

三星任务。

该session约983行，包含三个kind导航、search debounce、CRUD、edit lease、published Create preservation、remote Save/Delete、reconnect retry和Macro Load。错误可能让stale response覆盖新draft、让已提交item丢失identity或让remote truth清除protected buffer。

## 范围内

* 新增`libraryMutationWorkflow.ts`，负责Library client、fresh lease、create/update/delete transaction与release。
* 新增`libraryRemoteSyncCoordinator.ts`，负责Library invalidation queue、serialized drain、connection/focus reconcile与bounded retry。
* factory继续唯一声明和写入全部`$state`，保留navigation identity/commit gateway，并通过live snapshot/commit ports装配两个模块。
* public `LibrarySession` return surface、LibraryPanel consumer、DOM、文案和交互不变。

## 范围外

* 不建立Macro/Library共享的`GenericContentSession`、base class或feature flag。
* 不把kind/search/selection/draft/lease/rune state移入新模块或第二份cache。
* 不改变LibraryItemV1、HTTP、content edit lease、Macro Load、validation、DOM或presentation。
