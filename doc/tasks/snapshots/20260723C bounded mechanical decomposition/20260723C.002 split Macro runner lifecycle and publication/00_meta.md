# 20260723C.002 Split Macro Runner Lifecycle and Publication

## 任务概括

`server/macroRunnerService.ts`当前587行，既是HTTP/WebSocket consumer使用的public service，也实现run bootstrap/execute/finish、Pause/Resume/runtime Input和revisioned snapshot/delta publication。本task沿这三个state machine拆分，继续共享同一`LiveRun`对象。

## 正式 task 级别及定级原因

三星任务。Start包含controller authorization、terminal structure lock、manifest与first event的严格publish顺序；Pause/Input影响可取消await；publication必须保持revision和event window连续性。任一移动失序都会产生重复side effect或多端quietly inconsistent状态。

## 范围内

* 抽出live-run lifecycle、pause/input interaction及snapshot publication internal模块。
* `MacroRunnerService`保留全部现有public method、error class与preflight type。
* live registry与每个`LiveRun` mutable state各只有一个owner/object。
* 所有相关文件不超过400行。

## 范围外

* 不改MacroDefinition、Flow executor、Action runtime、Trace schema或Room protocol。
* 不改变runner status、event kind、error code、25ms batching或cooperative checkpoint budget。
* 不持久化live cursor，不恢复server restart后的run。
