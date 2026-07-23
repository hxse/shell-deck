# Blueprint Contract

## Added Semantics

无。`20260723B`及`.001-.004`只允许behavior-preserving refactor。

## Frozen Semantics

* `20260723A`完成后的源码、active specs、current tests与public import构成行为基线。
* Room single-controller、heartbeat、mutation admission、terminal lifecycle、PTY generation/launch guard、cwd refresh与broadcast ordering全部冻结。
* Macro/Library saved record的content lease、expected revision、operation identity、pending feedback、published-Create preservation、remote invalidation/retry和navigation全部冻结。
* Macro visual editor的DOM element/order、control order、mutation gateway、collapse、palette placement、keyboard/focus、resize clamp与restore-focus全部冻结。
* Theme、presentation class、responsive geometry、schema、wire/filesystem contract与用户文案不变。

## Child sequence

1. `.001`抽出`roomControlCoordinator.ts`与`terminalBackendCoordinator.ts`。
2. `.002`抽出Macro-specific MutationWorkflow与RemoteSyncCoordinator。
3. `.003`抽出Library-specific MutationWorkflow与RemoteSyncCoordinator。
4. `.004`让`MacroInsertionPalette.svelte`统一拥有palette lifecycle，并抽出`macroFlowTreeController.svelte.ts`与`parallelLaneEditorController.svelte.ts`。

child必须依序实施。前置边界有误时回到对应change修正，再让后继自动rebase；不得在后继change复制或覆盖前置实现。

## 共同拆分规则

* 原facade/factory/component仍是唯一public composition root；调用者不得直接依赖private coordinator internals，除非child spec明确列出UI controller consumer。
* state只保留一份。coordinator通过明确的read/callback ports消费owner state，不建立mirror map、cache或第二套rune state。
* 函数移动必须保持调用顺序、await边界、guard时点、错误传播、feedback文本和publish point。
* 每个coordinator必须是domain-specific；禁止带feature flag的generic session、service locator或compatibility adapter。
* 新模块不得反向import原入口形成cycle；原入口删除已迁移的重复实现。
* public type/API、protocol/schema、DOM/visual output与current behavior不得为了更漂亮的抽象而改变。

## Child停止线

出现任一情况必须停止当前child：

* 需要两个state owner才能成立。
* 必须改变protocol、public consumer、DOM或behavior assertion。
* focused Gate只能通过放宽时序、删断言或更新aggregate digest。
* 新模块产生import cycle、隐式global或callback递归。
* `jj`自动rebase产生冲突。

## 整链Gate

每个child必须运行`just check`、`just build`、对应focused unit/integration/E2E与`just diff-check`。最终`.004`还需运行`just test-unit`、`just test-integration`、`just test-e2e`，扫描production import cycle、旧实现残留、公开API/DOM structure drift与conflict marker，并回填root review/active specs。
