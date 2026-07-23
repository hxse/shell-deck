# 20260723C.013 Split Mutable Oversized Test Sources

## 任务概括

本task只重组mutable test evidence：

* `comprehensiveMacroUiBehaviorCurrent.spec.ts` 940行；
* `roomLargeReplay032.spec.ts` 438行；
* `roomRuntimeSync035.saved-content.spec.ts` 431行；
* `tests/ui-baseline/031B/controlInventory.ts` 580行。

`macroDefinition034.test.ts`由`.010`随validator一起拆。1041行`comprehensiveUiBehavior031B.historical.ts`已经退出Playwright discovery且只由raw-byte hash oracle引用；本task删除这份退役源码与hash-only断言，历史内容仍可从`jj`恢复，独立的结构化control inventory baseline保留。

## 正式 task 级别及定级原因

三星任务。测试本身是重构的oracle；如果为了行数删expect、缩成smoke或更新digest掩盖coverage下降，会让前十二个child失去可信验收。

## 范围内

* 把independent Room cases按scenario拆成多个spec。
* 把单一Macro comprehensive journey按ordered step helper拆文件，保留同一个test lifecycle。
* 把control inventory按historical constants/current controls/evidence拆分，原import path保留facade。
* 增强test inventory对split helper evidence的归属审计。
* 删除退役historical journey及只校验其raw-byte hash的oracle，不建立file-size例外。

## 范围外

* 不改production。
* 不改变test case/title、test.step顺序、expect、route、wait、timeout、fixture或fault injection。
* 不删除或放宽current test、expect、step、fault或结构化control inventory evidence。
