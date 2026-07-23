# Review and Verification

## 总体判断

本轮同时审阅代码、测试与文档。新增386行`macroFlowInsertionController.svelte.ts`，唯一声明anchor、summary、loop/action flags、position、palette element、notice与move node ID八个rune；它通过live getter读取draft与palette mode，并只经parent `updateDraft`提交，不缓存definition。

`MacroFlowNodeList.svelte`由431行降至218行，保留props、recursive snippet、Flow DOM、class、test ID、control order与child hierarchy。既有`MacroInsertionPaletteLifecycle`继续唯一实现viewport placement、focus、Escape与trigger restoration；controller只消费component创建的typed lifecycle instance。Flow tree collapse、ID reconciliation与structure mutation仍只属于`macroFlowTreeController`。

最终未发现未解决P1/P2。

## Gate 结论

Close Gate通过。

* Code Gate：通过。component 218行、controller 386行；本轮修改的三个mutable unit test分别为278、202、155行，均不超过400行。
* Ownership Gate：通过。component没有insertion `$state`；controller精确拥有八个`$state`，没有draft cache、第二个mutation gateway或placement算法。
* Behavior Gate：通过。before/after/inside/empty-body、new/move、action-only/loop flags、invalid anchor、failed insert、terminal adoption与focus/Escape/resize行为保持。
* Structure Gate：通过。Flow element count仍为22；唯一source-level inventory delta是`MacroInsertionPalette`从local identifiers切换到controller live getter/setter，已用exact entry与digest登记，未放宽其他component。
* Current Docs Gate：通过。同步`macro_template_contract.md`与`shell_deck_architecture.md`；用户入口与schema未变，Quickstart无需修改。

## Findings and Solutions

### Finding 1：普通`.svelte.ts`不能直接消费Svelte component module的named export类型

* 级别：P2 / L1。
* 位置：`macroFlowInsertionController.svelte.ts`的palette lifecycle wiring。
* 问题：初版直接从`MacroInsertionPalette.svelte`import class与types；`svelte-check`接受，但plain `tsc --noEmit`按`*.svelte`shim解析，报告三个TS2614。
* 为什么重要：会直接阻断默认`just check`，也不应为了本次机械拆分移动或复制viewport/focus算法。
* 证据：`just check-ts`稳定报告`MacroInsertionPaletteLifecycle`、`InsertionPalettePosition`与`MacroPaletteItem`不是`*.svelte`可见named export。
* 推荐处理：component继续在Svelte-aware边界创建既有lifecycle，controller通过structural typed port消费实例；只移动state/commands，不移动算法。
* 修改归属：只改代码。
* 是否阻断 Gate：修复前阻断；当前已修复。

### Finding 2：controller getter wiring会改变source-level structure digest

* 级别：P2 / L1。
* 位置：`MacroFlowNodeList.svelte`的`MacroInsertionPalette`binding及`.003/.004`structure oracle。
* 问题：rendered DOM、prop值和element count不变，但source oracle会把attribute expression文本纳入digest；local identifier改为`insertion.*`后，旧digest按设计失败。
* 为什么重要：直接更新aggregate hash会隐藏额外结构变化；保留component mirror rune来维持identifier又会违反本task唯一state owner。
* 证据：parent/current inventory均为22 entries，只有`MacroInsertionPalette`一条entry变化，parent/current per-file digest分别为`7bbb9d90fd1bbccec7c662ef8615dfedde25a26c8d7a6a7d8306ed97ad1e40ee`与`504a2ebf4fb51fb4ee0696c0fec78f2910ac9db12ee93b266e8ae2ee503935b2`。
* 推荐处理：在closeout oracle中登记该per-file count、digest及完整controller binding entry；其余文件继续逐项对照历史baseline，同时同步aggregate workbench digest。
* 修改归属：代码与测试一起改。
* 是否阻断 Gate：修复前阻断；当前已修复。

### Finding 3：terminal adapter必须保留parent的adoption与recursive lookup顺序

* 级别：P2 / L1。
* 位置：`macroFlowInsertionController.svelte.ts`的`updateNodeTerminal`。
* 问题：审查中发现用`findNodePosition/resolveBodyPath`替代原recursive lookup会扩大本次机械拆分的行为面，尤其是临时invalid/duplicate-ID draft。
* 为什么重要：本task不授权terminal mutation语义变化；adoption、lookup与mutator顺序必须和parent一致。
* 证据：parent顺序为adopt terminal prefix → depth-first find node → mutate；最终controller保留相同顺序与递归遍历分支。
* 推荐处理：移动原递归lookup而不改写为另一套解析路径。
* 修改归属：只改代码。
* 是否阻断 Gate：修复前阻断；当前已修复。

## 需要人工拍板

无。

## AI 可直接修

Finding 1至Finding 3均已在当前change内修复。未留下待修L1/L2。

## 未覆盖与残余风险

未运行全仓全部unit/integration/E2E组合；本task不改变schema、server/runtime或rendered DOM，已覆盖Flow commands、Macro validation、exact structure以及完整Macro browser journey，因此不阻断Close Gate。`.013-.014`的test拆分与全仓file-size Gate不属于本task。

## 审阅范围

* 文档：当前task全套文档、task index、active Macro contract与architecture。
* production：Flow component、新insertion controller、tree controller、palette lifecycle、Flow commands/defaults与terminal adoption wiring。
* 测试：Macro visual ownership oracle、Flow commands、Macro validation、workbench/theme exact structure及Flow/Layout/comprehensive Macro E2E。
* 历史基线：当前change父revision `20260723C.011`中的431行`MacroFlowNodeList.svelte`。

## 验证结果

* `just test-20260723c-012`：20项unit/structure test通过、209 assertions；7项Playwright E2E通过，固定`--workers=1`。
* `just check`：style residue、TypeScript与Svelte检查通过，0 error、0 warning。
* `just build`：production build通过，227 modules transformed。
* `just diff-check`：通过。
