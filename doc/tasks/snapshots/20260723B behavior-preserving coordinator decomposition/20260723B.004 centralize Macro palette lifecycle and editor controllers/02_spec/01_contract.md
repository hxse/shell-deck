# Formal Contract

## Palette lifecycle owner

`MacroInsertionPalette.svelte`导出唯一`MacroInsertionPaletteLifecycle`实现。它拥有：

* trigger element capture；
* anchored initial position；
* palette实测width/height后的above/below、x/y/max-height clamp；
* mount/open后的first enabled control focus；
* resize后的无focus reposition；
* Escape/cancel后的trigger focus restoration。

两种palette继续使用12px viewport margin、8px trigger gap、360px estimated height/half-width和既有above/below selection公式。centered mode保持position null；missing trigger保持centered fallback。两个parent只保存当前domain insertion state、reactive position和bound palette element，并通过thin wrapper调用同一lifecycle。

## Source与runtime structure

为保持per-file baseline，`MacroFlowNodeList.svelte`与`ParallelLaneTabs.svelte`现有markup、`<svelte:window>`、component/element hierarchy、non-presentation attributes、test ids、control order与class不变。Parallel palette不因共享lifecycle而迁移到不同component boundary；共享的是lifecycle implementation，不是DOM owner。

## MacroFlowTreeController

`createMacroFlowTreeController`接收live `draft()`、唯一`updateDraft(mutator)`和insertion notice port。它不缓存draft。它拥有：

* root/nested node move/remove/update与node lookup；
* node/If branch collapse state和rename/removal key reconciliation；
* If/Elif/Else structural mutation；
* For range mode与text-list insert/update/remove/move structure version；
* duplicate node ID notice。

component继续拥有palette domain state、artifact/terminal render adapters、recursive snippet及all-node palette projection。controller的每次definition mutation只调用传入的既有`updateDraft`。

## ParallelLaneEditorController

`createParallelLaneEditorController`接收live `draft()`、`nodeId()`、selected-lane ports、terminal/adoption ports、唯一`updateDraft(mutator)`与palette-close port，不缓存draft。它拥有：

* Parallel/lane/action/output lookup与mutation；
* lane add/remove、terminal compatibility与unique terminal choice；
* action add/move/remove、collapse与ID reconciliation；
* lane ID/label、output ID/source/collect-text与notice；
* capability-dependent lane action/capture projection。

component继续拥有selected-lane reactive wiring、palette open state、render snippets与outer artifact composition。

## Frozen behavior

schema/default ids、confirm/notice文本、mutation ordering、selected lane、collapse behavior、anchored/centered placement、focus target、Escape/scrim/Cancel behavior、failed insertion保持open、DOM/presentation与current-node projection全部不变。

## Tests

focused Gate至少覆盖：

* exact source structure fingerprint与style residue；
* controller single-updateDraft/no-draft-cache/module-consumer boundary；
* default/tree/lane mutation unit behavior；
* anchored/centered viewport clamp、initial focus、Escape/Cancel/restore-focus；
* full Macro flow/layout/current behavior journeys。

正式Gate为`just check`、production build、focused unit/E2E、`just test-unit`、`just test-e2e`与`just diff-check`；structure delta、duplicate lifecycle algorithm、direct draft cache或warning阻断完成。
