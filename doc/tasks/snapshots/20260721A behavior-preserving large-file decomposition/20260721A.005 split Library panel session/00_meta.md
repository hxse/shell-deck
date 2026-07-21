# 20260721A.005 Split Library Panel Session

## 任务概括

拆分`src/lib/components/LibraryPanel.svelte`的Directory/Global、Prompt/Note/Macro JSON navigation、search、saved record/edit lease、CRUD、Load和remote invalidation竞态。LibraryPanel继续保留现有workbench markup与控件组合。

## 正式 task 级别及定级原因

三星任务。

Library具有跨Room/process saved truth和browser-local draft，且tab/select/New/Save/Delete都可能等待lease release或文件锁。错误抽取会由旧continuation清掉新draft、复活lease、展示旧revision或丢失唯一preserved buffer。

## 范围内

* 抽取Library record/edit session。
* 抽取navigation串行协调与remote invalidation queue。
* 抽取search/filter projection。
* 保留Panel现有markup、clipboard、Validate与Load按钮行为。

## 范围外

* 不改变Directory/Global存储位置、item identity或revision/lease语义。
* 不改变Prompt、Note、Macro JSON正文与validation规则。
* 不新增Duplicate/clone；Copy仍只写clipboard。
* 不与MacroPanel合并成泛型业务框架。
