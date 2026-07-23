# Formal Contract

## 任务边界

允许新增`macroFlowInsertionController.svelte.ts`。`MacroFlowNodeList.svelte`的props、markup、snippet/component hierarchy、attributes/classes/test IDs和`MacroInsertionPalette`owner位置不变。

## 任务规范

### 唯一insertion state

* anchor、summary、loop/action flags、position、palette element、notice与move node ID只由新controller声明一次。
* component不得保留mirror rune；controller不得缓存Macro draft。
* tree collapse/ID state仍在`macroFlowTreeController`，placement/focus算法仍只在`MacroInsertionPaletteLifecycle`。

### Anchor与commands

* before/after/inside/empty-body anchor shape、body path clone和allow-loop/action-only判断不变。
* draft变化时继续用`isInsertionAnchorValid`及control-body fallback检查current anchor。
* new node继续使用`defaultFlowNode`与`insertNodeAtAnchor`；move继续使用`canMoveNodeToAnchor/moveNodeToAnchor`。
* failed insert显示相同`Insertion failed: <reason>`并保持open；successful insert/move执行原cancel/restore。
* terminal adoption和node terminal mutation仍只通过parent现有`updateDraft`。

### Palette interaction

* open mode、initial position、settle getter、resize、Escape、Cancel/scrim及focus restoration不变。
* controller只调用existing lifecycle，不实现任何viewport/querySelector/focus算法。
* palette bind element、style string与blocked flag投影不变。

### Recursive presentation

Flow body/node DOM、render recursion、depth guide/separator、current-node class、control order和child component props exact不变。

## 示例

正例：palette打开后另一个mutation删除anchor node。controller设置现有target-changed notice并关闭，不把node插到相同index的其他body。

正例：窄viewport anchored palette打开，first enabled button聚焦；Escape关闭并恢复发起按钮。

反例：把recursive snippet移到新component导致DOM boundary变化，或controller复制lifecycle clamp公式，均超出本task。

## 测试

* `macroFlowVisualEditor006`冻结sole insertion/lifecycle/tree owner和default/anchor commands。
* `.003/.004`structure oracle冻结exact markup/non-presentation inventory。
* Macro flow/layout/comprehensive E2E冻结nested insert/move、centered/anchored、focus/Escape/resize。
* source test禁止component残留placement算法或controller draft cache。
* 正式Gate：`just check`、build、focused unit/E2E、`just diff-check`；本轮未执行。
