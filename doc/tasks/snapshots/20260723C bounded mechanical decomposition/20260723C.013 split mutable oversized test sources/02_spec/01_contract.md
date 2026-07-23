# Formal Contract

## 任务边界

允许移动mutable test case/body到新`.spec.ts`或test helper，更新显式discovery/inventory path，把`controlInventory.ts`变成稳定facade，并删除不参与discovery的退役historical journey及其hash-only oracle。禁止任何production变化。

## 任务规范

### Macro comprehensive journey

* top-level test title、single page/context lifetime和从空状态开始的顺序不变。
* existing `test.step`标题、调用顺序、UI action、expect、clipboard/notification/terminal/runtime fault保持。
* helper只接收显式Playwright/page/state参数，不建立跨test global mutable state。
* 每个helper及facade不超过400行。
* inventory必须把declared helper AST归属到原case，expect/route/wait总数不得下降。

### Room E2E

* `roomLargeReplay032`六个case与saved-content七个case按scenario移动；title/body/timeout/fault injection原样。
* helper/import可以共享，但case之间的fixture isolation和worker=1 contract不变。
* public `test:e2e`自动发现新spec；task-specific just recipe不漏新路径。

### Control inventory

* 原模块全部export name/value/array order保持。
* historical source constants与baseline runtime IDs放入明确只读模块；current digest/control IDs和attribution evidence各自独立。
* facade只re-export，不复制array。
* `uiBehaviorInventory031B.test.ts`的source/runtime count、digest与attribution检查不放宽。

### Evidence parity

* pre/post列出每个test title、expect/route/wait数、ordered step title及forced test settings。
* current source digest因文件边界必然变化时，必须同时有上述exact parity；禁止只改aggregate。
* no `test.only/skip`、unexpected timeout/xfail或coverage path遗漏。
* 退役`comprehensiveUiBehavior031B.historical.ts`必须从current tree消失；不得以分片、generated copy、digest白名单或新路径重新引入。结构化`.031B` control inventory baseline继续exact校验。

## 示例

正例：把“pending Macro Save…”整个test原样移动到新的saved-content-save spec，并更新inventory file list；case title和body不改。

正例：Macro journey把一个完整`test.step`抽为helper，inventory把该helper的13个expect仍归到原test，总数保持657。

反例：把多个expect替换成一个screenshot、把七个race case合成一条happy path，或更新digest后接受expect减少，均阻断。

## 测试

* `currentTestJourneyInventory010`承担case/helper attribution parity。
* `uiBehaviorInventory031B`继续校验结构化historical/current control inventory；current journey inventory断言退役raw journey不存在。
* 运行全部拆分Macro/Room spec及current comprehensive UI。
* 运行public `test:e2e`证明自动发现；运行default unit证明所有inventory test进入Gate。
* 正式Gate：`just check`、build、focused/full unit与E2E、`just diff-check`；本轮未执行。
