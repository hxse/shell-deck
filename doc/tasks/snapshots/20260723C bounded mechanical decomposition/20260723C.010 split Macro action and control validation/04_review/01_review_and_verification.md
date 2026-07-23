# Review and Verification

## 总体判断

本轮同时审阅代码、测试与文档。`macroNodeValidation.ts`由445行收至54行，并继续唯一拥有body traversal和node dispatch；Action、Control与pure text matcher分别为225、227、15行。所有validator仍同步追加同一`ValidationContext.issues`，recursive If/For/terminal control/Parallel child继续回到原node facade，没有建立partial public gateway或第二份artifact/context真值。

原510行unit test按core/action/control原样移动为171、210、114行，fixture为27行；12个原test title、64个static `expect`位置、77次runtime expectation及每个test body的独立semantic SHA-256均保持。新增192行decomposition oracle冻结上述证据、唯一production import graph、dispatch phase order、default unit discovery及400行上限。

最终未发现未解决P1/P2。

## Gate 结论

Close Gate通过。

* Code Gate：通过。facade、Action、Control、shared helper及全部新增mutable test文件均不超过400行。
* Contract Gate：通过。public API、schema、issue code/path/message/order、persistable/runnable边界、recursive context和artifact registration时点不变。
* Test Oracle Gate：通过。逐test title/expect/body digest parity、完整multi-issue exact array与production import graph均已冻结。
* Current Docs Gate：通过。同步`active_specs/shell_deck_architecture.md`；用户入口和行为不变，因此Quickstart与Macro usage contract无需修改。

## Findings and Solutions

### Finding 1：删除旧unit文件后，默认与历史focused入口仍会指向不存在的路径

* 级别：P2 / L1。
* 位置：`package.json`的`test:unit:core`及`justfile`中的`test-001`、`test-20260723b-002`、`test-20260723c-008`。
* 问题：只拆test文件而不更新全部live command entry，会让默认unit Gate或旧task focused recipe直接报file not found。
* 为什么重要：这会使机械拆分本身破坏现有验证入口，并让新增case无法由默认Gate发现。
* 证据：拆分前所有入口均显式引用已删除的`tests/unit/macroDefinition034.test.ts`。
* 推荐处理：把每个live入口替换为core/action/control三文件，并在默认unit入口加入decomposition oracle。
* 修改归属：代码与文档一起改。
* 是否阻断 Gate：修复前阻断；当前已修复，并由static oracle确认旧路径不存在且四个新test入口均被显式发现。

## 需要人工拍板

无。

## AI 可直接修

Finding 1已在当前change内修复。未留下待修L1/L2。

## 未覆盖与残余风险

未运行全仓全部unit/integration/E2E组合；本轮已覆盖全部Macro definition case、相关Flow/runner unit、20项Macro integration与12项Macro editor E2E。任务不改变schema、runtime或UI，且逐body oracle与完整multi-issue oracle均通过，因此不阻断Close Gate。`.011-.014`的后续拆分与最终全仓400行Gate不属于本task。

## 审阅范围

* 文档：当前task全套文档、task index、active Macro contract与architecture。
* production：definition facade、node facade、Action/Control/shared validator、validation context/primitives/reference validator，以及全部production import consumer。
* 测试：原12个Macro definition case、decomposition oracle、Flow/editor/runner unit、Macro runtime/AgentEvent integration与Macro editor E2E。
* 历史基线：当前change父revision `20260723C.009`中的445行`macroNodeValidation.ts`与510行`macroDefinition034.test.ts`。

## 验证结果

* 原test baseline：12 test通过、77 runtime expectation；static evidence为12 case、64个`expect` call site及12个独立body digest。
* 拆分后原case：12 test通过、77 runtime expectation；parity oracle 2 test通过。
* `just test-20260723c-010`：24 unit、20 integration、12 Playwright E2E通过；E2E固定`--workers=1`。
* `just check`：style residue、TypeScript与Svelte检查通过，0 error、0 warning。
* `just build`：production build通过，224 modules transformed。
* `just diff-check`：通过。
