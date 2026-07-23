# 20260723C.009 Split Library List Navigation and Edit Orchestration

## 任务概括

`src/lib/library/librarySession.svelte.ts`当前766行。现有factory已装配MutationWorkflow、RemoteSync和NavigationCoordinator，但仍直接实现kind/search/list、Select/New、Edit/Save/Cancel/Remove、lease与Macro Load的完整command流程。本task继续按Library domain拆分，factory保持唯一rune owner。

## 正式 task 级别及定级原因

三星任务。三个kind、debounced search、navigation identity、content lease、remote Save/Delete和published Create preservation共同保护本地buffer；stale response若绕过current identity会静默清除用户内容。

## 范围内

* 抽出Library list/search coordinator。
* 抽出Library edit/navigation orchestration，继续复用既有NavigationCoordinator与MutationWorkflow。
* factory唯一声明/写入kind/selection/draft/lease/dirty/notice runes和public return。
* 所有文件不超过400行。

## 范围外

* 不与Macro共享generic session/base class。
* 不改变LibraryItem、HTTP/search、Macro Load、clipboard或UI。
* 不移动LibraryPanel presentation和Validate行为。
