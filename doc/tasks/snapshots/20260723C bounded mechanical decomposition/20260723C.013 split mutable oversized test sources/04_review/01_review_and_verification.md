# Review and Verification

## 总体判断

本轮只机械重组test evidence，没有修改`src/`、`server/`或`script/` production实现。

`comprehensiveMacroUiBehaviorCurrent.spec.ts`继续只有一个top-level test、同一个page/context lifetime和原顺序的11个`test.step`；authoring、flow、runtime helper只接收显式`Page`与`MacroJourneyState`，没有跨test global mutable state。Room large replay六个case与saved-content七个case按scenario进入可由public Playwright自动发现的新spec，原test statement hash保持。`controlInventory.ts`只做稳定re-export，全部runtime export name/value/array order与父change一致。

已退出Playwright discovery且只由hash-only oracle消费的1041行`comprehensiveUiBehavior031B.historical.ts`已删除；`jj`历史仍可恢复原文，结构化`.031B` control inventory baseline保留。当前`tests/`全部文件不超过400行；最大test source为389行。最终未发现未解决P1/P2。

## 拆分结果

* Macro comprehensive：facade 88行；shared helper 266行；authoring 238行；flow 290行；runtime 200行。
* Room large replay：shared helper 190行；stream 75行；retention 183行；lifecycle 23行。
* saved-content：save 158行；create 191行；reconnect 107行。
* control inventory：facade 36行；historical 294行；current 128行；evidence 190行。
* inventory tests：current journey 341行；UI behavior 325行。

## Evidence parity

* current journey仍为51个唯一title、657个`expect`、27个route、20个wait，aggregate digest保持`259d3b4b8eeee5b5027229c9961319dc4d3d11a2c4e512ac8571e218dc4e275a`。
* Macro comprehensive仍为一个title、11个ordered step、109个`expect`、1个route、1个wait；serial mode、600秒test timeout及两个page timeout保持。
* Room large replay仍为六个title、62个`expect`、1个wait、1个`waitForTimeout`；每个完整test statement hash与父change一致。
* saved-content仍为七个title、74个`expect`、10个route；每个完整test statement hash与父change一致。
* control inventory runtime value digest保持`163e4576aedbb929d8aa2d8a108cd62c36fbdde98ce5ba06b508c19eedc55071`。
* 退役historical journey及其raw-byte hash-only断言已删除；current inventory显式断言旧路径不存在，结构化historical control export仍保持exact value/order。

## Findings and Solutions

### Finding 1：只扫描top-level spec会丢失Macro helper evidence

* 级别：P2 / L1。
* 问题：把完整`test.step`移入helper后，原case AST不再直接包含其中的`expect`、route和wait；若只更新aggregate digest，会让coverage下降无法被发现。
* 处理：声明完整helper source group，把helper AST重新归属到原journey，并同时冻结title、ordered step、109/1/1计数、forced settings和post-split source digest。
* 状态：已修复。

### Finding 2：saved-content标题断言初版由current source自证

* 级别：P2 / L1。
* 问题：初版虽保留51-case aggregate，但task-specific saved-content断言把当前扫描到的title作为expected；同改title与source digest可能绕过局部意图。
* 处理：baseline显式保存七个父change title及完整test statement SHA-256，current逐项exact对照；large replay采用同一规则。
* 状态：已修复。

### Finding 3：forced settings baseline类型过宽

* 级别：P2 / L1。
* 问题：运行时inventory通过，但`SourceExpectation.forced`初版为optional，`tsc`拒绝把它用于exact array对照。
* 处理：三组baseline统一要求显式`forced`数组，saved-content写明空数组；`just check`随后通过。
* 状态：已修复。

### Finding 4：public full E2E出现一次既有性能阈值波动

* 级别：P3 / L1。
* 问题：第一次67-case full E2E中，原样移动的37 MB PTY case测得`maxFrameGapMs=133.3`，超过既有`<100ms`阈值；其title/body/hash均未变化，task-specific run此前已通过。
* 处理：不放宽阈值、不修改test。精确单case复跑通过（4.6秒），随后第二次public full E2E 67/67通过。
* 状态：无稳定回归；保留为资源敏感Gate的已知波动证据。

## Gate 结论

Close Gate通过。

* Code Gate：通过。production零改动；所有新增/修改mutable test、helper与inventory module不超过400行。
* Behavior/Evidence Gate：通过。case title/body hash、Macro step order、assertion/fault/timeout及control export value/order保持；退役raw journey删除不影响current discovery。
* Discovery Gate：通过。public `test:e2e`自动发现全部新spec；所有task-specific just recipe已移除旧路径，inventory同时断言旧primary file不存在。
* Current Docs Gate：通过。同步`shell_deck_architecture.md`与`ui_theme_contract.md`，产品schema、API和用户流程未变。

## 验证结果

* focused inventory：18项unit通过、513 assertions。
* `just test-20260723c-013`：18项unit与15项Playwright E2E通过，E2E固定`--workers=1`。
* `just check`：UI style residue、TypeScript、Svelte全部通过，0 error、0 warning。
* `just build`：production build通过，227 modules transformed。
* `bun run test:unit`：Theme 6、unit core 231、integration 53，合计290项通过。
* `bun run test:e2e`：最终67/67通过，固定`--workers=1`；第一次波动与复跑证据见Finding 4。
* `just diff-check`：通过。

## 需要人工拍板

无。

## 未覆盖与残余风险

37 MB浏览器帧间隔断言对整机瞬时调度敏感，但当前change没有改其body或阈值，focused、精确复跑及最终full run均通过。`.014`仍负责把全仓400行限制接入默认Gate并完成root closeout。
