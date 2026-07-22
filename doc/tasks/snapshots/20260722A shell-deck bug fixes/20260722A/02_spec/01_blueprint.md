# Blueprint Contract

## 任务边界

### Added Semantics

根任务本身不直接增加产品语义。具体Added Semantics只能由编号子任务冻结并实现。

### Frozen Semantics

* `20260721A.010`完成后的current源码、active specs与current tests是本系列输入基线。
* Room mutation继续由server-side controller guard裁决；Macro/Library saved record继续使用content edit lease与expected revision。
* active run继续执行Start时冻结的saved MacroRecord revision，不重读browser-local draft。
* terminal Prepare只由唯一显式按钮触发；bug修复不得引入隐式Prepare。
* current-schema变化必须hard cut；不得接受旧字段缺失、旧别名或自动补写。

## 子任务规则

* 一个子任务只处理一组能共同描述、共同回归的bug；每个子任务独立jj change。
* 实施前必须写`00_meta`、problem context、formal contract和execution plan。
* 实现只修改formal contract列出的primary files及必要直接consumer/test/spec。
* UI修复保留未列入范围的布局、交互、DOM语义与test id；新增反馈必须可访问并有稳定自动化断言。
* schema或protocol变化必须端到端修改type、strict validator、default、runtime transport、consumer和fixtures，不保留optional legacy fallback。
* 自审按P1/P2/P3记录，未解决P1/P2阻断完成。

## 首个子任务

`.001`集中修复同一Macro workbench authoring/runtime反馈面：For text-list item就地插入、active run编辑锁与current stage反馈、App通知重复次数/间隔、Parallel显式无text output authoring，以及loop template token按钮的冗余与尺寸。

## Gate

每个子任务至少执行focused unit/component/browser测试、`just check`、`just build`、受影响current integration/E2E、`git diff --check`与残留扫描。涉及strict schema时增加旧shape拒绝断言；涉及running/read-only UI时覆盖controller与observer状态。
