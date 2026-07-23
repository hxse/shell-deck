# Formal Contract

## 任务边界

允许新增`libraryListCoordinator.ts`与`libraryEditOrchestrator.ts`或等价Library-specific模块。`createLibrarySession` options/return和LibraryPanel consumer不变；现有`LibraryNavigationCoordinator`、MutationWorkflow、RemoteSync职责不合并。

## 任务规范

### 唯一state与identity

* kind/search/items/selection/draft/editing/lease/dirty/status/error/notice runes只在factory声明。
* list coordinator可唯一拥有180ms timer和request generation，不缓存items/selection。
* edit orchestrator无rune、无record cache；结果由factory经NavigationCoordinator current identity判断后commit。
* operation pending仍由既有NavigationCoordinator驱动，不能出现第二个generation owner。

### List/search/navigation

* tab-kind映射、query、180ms debounce、list ordering与invalid-item notice不变。
* 切kind/selection/New前的pending guard、discard confirm和lease release顺序不变。
* list continuation复核generation、kind和query。
* selected item不在result时：protected buffer只提示；clean readonly才clear。
* tab/filter preference callback时点不变。

### Edit与lease

* Edit取得fresh per-record lease；Save/Create/Remove走现有MutationWorkflow。
* successful Save安装revision、清dirty并保持Edit/lease；Done/Cancel按原语义release。
* first Create后lease竞争失败进入published-save preservation，保留submitted buffer与fresh identity。
* `Discard local copy`重读server truth；404 clear，其他失败继续保护buffer。
* remote lost lease/control loss不覆盖draft。
* Macro Load只在clean/current identity时切换Macro，Library state不被隐式清空。

## 示例

正例：切换Library kind时lease release await期间用户状态变化。旧navigation token不能再写kind/items或清draft。

正例：pending Save后remote Delete到达。先settle local operation，再按sequence更新saved-truth notice；submitted buffer保持。

反例：list coordinator持有`items`副本做client filter，或edit orchestrator设置`selectedItem`，均违反唯一truth。

## 测试

* `librarySession005`扩展sole-rune-owner、list/edit outcome与existing navigation identity。
* Library HTTP/process integration冻结lease/revision/published commit。
* CRUD/navigation/races/reconnect E2E冻结三kind、search、preservation、unload与panel retention。
* Macro Load相关tests冻结跨domain clean/dirty决策。
* 正式Gate：`just check`、build、focused unit/integration/E2E、`just diff-check`；执行结果见`04_review/01_review_and_verification.md`。
