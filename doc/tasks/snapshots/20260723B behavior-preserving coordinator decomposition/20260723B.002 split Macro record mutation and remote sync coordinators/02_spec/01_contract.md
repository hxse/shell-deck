# Formal Contract

## Public session

`createMacroRecordSession(options)`继续是唯一public factory；return getters/methods、Svelte reactive behavior与`MacroRecordSession`type不变。`MacroPanel.svelte`和`macroRunnerSession.svelte.ts`不直接import两个新模块。

## Rune ownership

全部user-visible/editable state继续由factory内同一组`$state`变量唯一拥有。MutationWorkflow不保存session state，只执行请求并返回outcome；RemoteSyncCoordinator只保存queue/timer/generation/serialization协调状态，通过ports读取factory live snapshot并请求factory执行`installRecord`/`setError`等commit。禁止第二份record/draft/lease cache。

## MutationWorkflow

workflow拥有：

* list/read/create-from-Library/Save-to-Library/delete等Macro-specific client调用；
* fresh edit/delete lease view、takeover/acquire、stale release与authoritative record read；
* validated create/update persistence、record identity/revision check；
* update lease retained/lost outcome；
* fresh Create后的lease acquisition与stale/published-create分类。

workflow返回`persisted`、`published_create`或`discarded`等显式outcome。只有factory应用editLease/leaseView、install record、preserve submitted definition和写error。operation-current callback必须在每个原有await后同位置执行；stale acquired lease必须释放。

## Published Create

first Create一旦server返回revision 1，即使controller、operation、remote Save/Delete或fresh lease acquisition跨越response边界，也不能假装未创建。若local operation identity仍匹配submitted visual/JSON revision，factory安装fresh record identity、保留submitted definition为当前buffer、清dirty并设置`publishedCreateBufferPreserved`/warning；不匹配则不覆盖新local truth。update绝不走Create preservation。

## RemoteSyncCoordinator

coordinator继续使用现有`MacroInvalidationQueue`的sequence watermark、own_ack/higher_revision/delete/unrelated分类和100/300/800ms bounded retry。它拥有：

* connection generation/focus reconcile；
* content change observe与serialized drain；
* template read generation；
* retry reset/schedule/dispose。

factory提供live snapshot：selected id/revision、editor generation、operation pending、protected buffer、connection generation。只有clean readonly selection可安装remote record；dirty、contentEditing、JSON editing、leaseLost或published buffer只显示changed/deleted feedback，不被覆盖。

## Frozen behavior

selection/Create/Edit/Cancel/Save/Delete、visual/JSON save、Save to Library、Start前persist、lease lost、confirm文本、error文本、timer label与beforeunload语义全部不变。DOM、class、focus、Theme与server contract无变化。

## Tests

focused Gate至少覆盖：

* `macroInvalidationQueue004` exact queue/retry；
* Macro record HTTP durability与content lease；
* `roomRuntimeSync035.saved-content` delayed Save/Create、remote Save/Delete、controller change、dirty/clean reconnect；
* Macro CRUD/JSON/Start current journeys与structure fingerprint；
* module boundary：factory是唯一rune owner，Macro/Library无generic session，新模块无component/runner consumer。

正式Gate为`just check`、`just build`、focused unit/integration/E2E、`just test-unit`与`just diff-check`；state duplicate、guard/await drift、source/DOM drift或warning阻断完成。
