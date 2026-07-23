# Formal Contract

## 任务边界

允许新增`macroRecordNavigationCoordinator.ts`与`macroRecordEditOrchestrator.ts`或等价Macro-specific模块。`createMacroRecordSession`的options、exports、return getters/commands和production consumer不变。

## 任务规范

### 唯一rune/commit owner

* templates、selected/base/draft、revision、editing/lease、dirty/preservation、pending/error/label runes只在factory声明。
* orchestrator不得使用`$state/$effect`，不得缓存record/draft/lease或直接暴露mutable reference作为长期state。
* 所有结果通过typed outcome返回；factory用current token再次判断后唯一commit。

### Navigation

* list generation、invalid record notice、null selection、dirty discard confirm和selector rollback不变。
* Select/New/Load from Library的lease release与operation identity顺序不变。
* Library Load已创建record但本地identity变化时，只返回created notice，不切换/覆盖。
* navigation不得隐式Prepare、Save或Start。

### Edit/persist

* begin Edit必须取得fresh content lease；Cancel/Done/selection transition按原路径best-effort release。
* Save/Create/Delete继续走现有MutationWorkflow和single operation token。
* persisted Save安装fresh revision、清dirty并保留edit lease。
* published Create lease transition失败时关联fresh record identity、保留submitted buffer并进入read-only preservation。
* JSON Save仍先parse/current validation，再经同一persist/commit gateway；失败保留exact buffer。
* dirty Start的record resolution继续严格串行Save/Create -> fresh revision/lease transition -> Start snapshot。

### Error与反馈

existing error formatting、mutation denied callback、notice/label/reset timer和confirm文案不变。orchestrator不吞错、不将stale outcome伪装成功。

## 示例

正例：Create已提交，等待fresh lease时controller变化。factory收到`published_create` outcome并安装fresh identity，但保留submitted draft、转read-only preservation；不得再次POST Create。

正例：Select请求在await期间用户New。旧read outcome因operation/editor identity不匹配被丢弃，不能覆盖New draft。

反例：navigation coordinator保存`selectedRecord`并在下次调用复用，或edit orchestrator直接设置`dirty=false`，均违反唯一owner。

## 测试

* `macroInvalidationQueue004`扩展sole-rune-owner/consumer/outcome boundary。
* `flowV2EditorCommands034`与Macro definition tests冻结draft mutation/schema。
* saved-content、record、feedback、reconnect及comprehensive Macro E2E冻结navigation/edit/race。
* integration冻结durable Create/Update/Delete、controller/content lease与dirty Start。
* 正式Gate：`just check`、build、focused unit/integration/E2E、`just diff-check`；本轮未执行。
