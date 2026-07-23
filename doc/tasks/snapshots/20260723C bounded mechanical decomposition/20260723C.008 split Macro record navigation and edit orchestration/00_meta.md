# 20260723C.008 Split Macro Record Navigation and Edit Orchestration

## 任务概括

`src/lib/macro/macroRecordSession.svelte.ts`当前691行。前次已抽mutation transport和remote sync，但factory仍同时实现list/navigation/New/Select/Library Load、Edit/Cancel/Save/Delete、JSON/Start record resolution和operation identity。本task继续拆纯orchestration，factory保留全部runes与public assembly。

## 正式 task 级别及定级原因

三星任务。dirty buffer、JSON edit、content lease、controller epoch、published Create preservation和remote invalidation可以跨await交错；若orchestrator持有旧snapshot或直接写第二份state，会覆盖用户较新的draft。

## 范围内

* 新建Macro-specific navigation orchestrator。
* 新建Macro-specific edit/persist orchestration模块。
* factory继续唯一声明/写入record/draft/lease/dirty/feedback runes及operation commit。
* 原return surface、JSON session、MutationWorkflow和RemoteSync行为不变。

## 范围外

* 不建立Macro/Library generic session或共享feature flags。
* 不改变Macro CRUD、schema、lease、Start、Library transfer或UI。
* 不把runner/editor component state并入record session。
