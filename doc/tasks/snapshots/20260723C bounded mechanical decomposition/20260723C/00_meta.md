# 20260723C Bounded Mechanical Decomposition

## 任务概括

`20260723B`已经完成Close Gate。本任务另起一个三星root，在不改变产品行为的前提下，把当前仍超过400行的production与mutable test文件沿既有职责边界继续拆开，并在最后建立默认file-size Gate，防止新模块再次长回大文件。

本任务共有十五个串行`jj change`：root只承载总体边界；`.001-.012`拆production；`.013`拆mutable oversized tests；`.014`增加Gate、运行全栈验证并完成root closeout。

## 正式 task 级别及定级原因

三星任务。

虽然目标是机械拆分，但覆盖atomic evidence persistence、Macro runner、content edit lease、Room controller/PTY callback、browser reconnect、saved-content race、Svelte rune ownership、validation issue ordering及完整UI evidence。错误很可能表现为quietly wrong，因此每个child必须有独立Formal Document、Code与Test Gate。

## 范围内

* 依次完成`.001-.014`，每个task对应一个平铺编号和一个串行`jj change`。
* 保留既有public API、protocol、schema、error code、DOM与用户行为，只移动ownership明确的实现。
* 所有project-authored code source最终不超过400行，包括production、test、tool、config与native helper；新文件同样受限。
* 以focused oracle证明atomic order、callback generation、single-state、issue order与UI interaction没有漂移。
* 最终把file-size检查接入默认`just check`并执行完整check/build/unit/integration/E2E/diff-check。

## 范围外

* 不增加功能，不改变current schema，不增加兼容层、alias、migration或feature flag abstraction。
* 不重新设计persistence、runner、controller、workspace、Macro、Library、validation或UI。
* 不删除、放宽、合并或改写测试断言来让重构通过。
* 不保留已经退出current Playwright discovery的historical test source；`.014`删除该退役文件及专用hash/豁免逻辑，独立control inventory baseline继续保留。
* 本轮只建立task/change/document stack，不修改production、test、script、package或justfile代码。

## 本轮停止线

root和`.001-.014`全部建立独立change，且每个task完成`00_meta`、`01_context`、`02_spec`、`03_execution`与index后停止。`04_review`、active spec同步、代码和测试只在以后逐child实施并通过对应Gate后写入。
