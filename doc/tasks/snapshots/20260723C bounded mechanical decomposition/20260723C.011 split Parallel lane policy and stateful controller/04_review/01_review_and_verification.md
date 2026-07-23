# Review and Verification

## 总体判断

本轮同时审阅代码、测试与文档。`parallelLaneEditorController.svelte.ts`由423行收至350行，新增216行pure policy与303行pure commands。policy只遍历显式传入的definition/lane/terminal choices；commands只修改显式传入的draft并返回structured result。controller继续唯一拥有两个rune、notice、confirm、selected-lane/collapse reconciliation及parent `updateDraft` gateway，没有缓存definition或建立第二个commit入口。

`ParallelLaneTabs.svelte`保持254行且byte-level SHA-256仍为`0d817d02d6dde3941c4de9a0c51a81b96d1ab43eed894a64c53eeb0503ff420f`。component DOM、attributes、classes、test IDs、control order、palette owner与focus wiring均未修改。

最终未发现未解决P1/P2。

## Gate 结论

Close Gate通过。

* Code Gate：通过。controller、policy、commands及两个mutable unit test均不超过400行。
* Ownership Gate：通过。pure modules没有rune、DOM、confirm、notice或`updateDraft`；controller仍只有两个`$state`，selected lane继续使用parent ports。
* Behavior Gate：通过。lookup、capability/capture policy、lane-local output source、duplicate checks、terminal adoption、add/remove/move与final Output invariant保持。
* Structure Gate：通过。既有workbench/theme exact structure oracle与component byte digest均通过。
* Current Docs Gate：通过。同步`macro_template_contract.md`与`shell_deck_architecture.md`；用户入口与UI未变，Quickstart无需修改。

## Findings and Solutions

### Finding 1：第一版拆分改变了terminal adoption与lane重查顺序

* 级别：P2 / L1。
* 位置：`parallelLaneEditorCommands.ts`的`setParallelLaneTerminal`。
* 问题：父实现的`updateDraft` callback先调用`adoptTerminalSelection`，再重新查找Parallel/lane；第一版command改成先确认lane存在，顺手消除了lane消失时可能留下的layout增量。
* 为什么重要：新顺序本身更atomic，但属于behavior fix，不属于本task声明的机械拆分。
* 证据：父controller callback顺序为adopt → findParallel → find lane → assign；最终unit冻结missing lane时adoption仍先发生，同时外层incompatible precheck继续阻止正常UI路径的无效adoption。
* 推荐处理：当前change恢复父顺序；若要改成atomic mutation，另建正式行为task。
* 修改归属：代码与文档。
* 是否阻断 Gate：恢复前阻断；当前已恢复。

### Finding 2：第一版拆分改变了missing-action rename返回与collapse语义

* 级别：P2 / L1。
* 位置：`parallelLaneEditorController.svelte.ts`的`setLaneActionId`。
* 问题：父实现通过duplicate检查后，无论`updateLaneAction`是否找到目标action，都会把collapsed ID从旧值改为新值并返回`true`；第一版改成仅在command成功时reconcile并返回真实结果。
* 为什么重要：新结果更准确，但同样超出mechanical-only范围。
* 证据：父controller无成功flag；最终source oracle要求collapse reconciliation不受command result限制，并由父revision对照冻结`true`返回。
* 推荐处理：当前change恢复父语义；stale invocation的atomicity修复另建正式行为task。
* 修改归属：代码与文档。
* 是否阻断 Gate：恢复前阻断；当前已恢复。

## 需要人工拍板

无。

## AI 可直接修

Finding 1与Finding 2的越界行为修复均已撤回，当前change只保留机械拆分。未留下待修L1/L2。

## 未覆盖与残余风险

未运行全仓全部unit/integration/E2E组合；本task不改变schema、server/runtime或component DOM，已覆盖全部Parallel policy/command边界、Macro validation、exact structure与完整Macro browser journey，因此不阻断Close Gate。`.012-.014`的后续拆分与全仓400行Gate不属于本task。

## 审阅范围

* 文档：当前task全套文档、task index、active Macro contract、UI contract与architecture。
* production：Parallel component、stateful controller、pure policy/commands、Macro defaults/artifact choices/terminal choices与唯一component consumer。
* 测试：new pure command/policy unit、Macro visual editor ownership oracle、Flow commands、Macro validation、theme/structure oracle及Flow/Layout/comprehensive Macro E2E。
* 历史基线：当前change父revision `20260723C.010`中的423行controller与254行`ParallelLaneTabs.svelte`。

## 验证结果

* `just test-20260723c-011`：22 unit/structure test通过、245 assertions；7项Playwright E2E通过，固定`--workers=1`。
* `just check`：style residue、TypeScript与Svelte检查通过，0 error、0 warning。
* `just build`：production build通过，226 modules transformed。
* `just diff-check`：通过。
