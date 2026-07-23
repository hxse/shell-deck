# Formal Contract

## Public session与rune ownership

`createLibrarySession(options)`继续是唯一public factory；return getters/methods、Svelte reactive behavior与`LibrarySession`type不变。全部kind/search/items/selection/draft/editing/lease/dirty/status/notice state继续由factory内同一组`$state`唯一拥有。

既有`LibraryNavigationCoordinator`继续由factory创建，并继续是operation generation、controller epoch及kind/selection/draft/revision/lease identity的唯一判定器。新模块不得复制navigation generation或持有第二份user-visible state。

## LibraryMutationWorkflow

workflow拥有：

* Library list/read/create/update/delete client调用；
* edit/remove lease view、takeover/acquire、stale acquired-lease release与authoritative read；
* create/update persistence及update lease retained/lost outcome；
* fresh Create后的lease acquisition；
* navigation/unmount/cancel所需的best-effort lease release。

workflow接收factory提供的operation-current与local identity callbacks，在原有每个await后保持同位置guard。它返回`persisted`、`published_save`或`discarded`等显式outcome；只有factory安装item、设置editLease/leaseView、保留submitted Create buffer、更新status/error/notice。

## Published Save

Create/Update一旦server返回authoritative item，即使controller、operation或lease先变化，也不能伪装为未保存。factory仍通过`LibraryNavigationCoordinator.hasLocalIdentity`校验kind、selected key/revision、draft identity/revision；匹配时安装saved identity并转read-only，Create无fresh lease时保留submitted buffer。identity不匹配时不覆盖更新的local truth。

## LibraryRemoteSyncCoordinator

coordinator继续使用现有`LibraryInvalidationQueue`，并仅拥有queue、serialized drain、read generation、reconciled connection generation和retry timer。它负责：

* connection/focus refresh；
* content change observe与serialized drain；
* clean readonly selection的remote read；
* protected buffer的changed/deleted decision；
* 100/300/800ms bounded retry与dispose。

factory提供live snapshot：kind/query、selected item、draft identity/revision、operation pending、dirty/editing/lease/lost/published buffer及connection generation；factory提供reload-list/read/install/clear/notice/error ports。coordinator不缓存item/draft/lease，不直接调用Svelte component。

## Frozen behavior

kind/search/selector/New/Edit/Save/Cancel/Copy/Remove/Refresh/Load into Macro、confirm/error/status/notice文本、180ms search timer、lease lost、published Create、beforeunload与panel visibility语义全部不变。DOM、class、focus、Theme、LibraryItemV1、HTTP和Macro contract无变化。

## Tests

focused Gate至少覆盖：

* `librarySession005` navigation/invalidation与single-rune-owner/module-boundary；
* Library store/HTTP/content lease durability；
* `.036` CRUD、navigation、pending Save/Create races、remote Save/Delete与reconnect；
* no generic Macro/Library session、新模块无component consumer、factory public surface不变。

正式Gate为`just check`、production build、focused unit/integration/E2E、`just test-unit`与`just diff-check`；state duplicate、navigation guard drift、source/DOM drift或warning阻断完成。
