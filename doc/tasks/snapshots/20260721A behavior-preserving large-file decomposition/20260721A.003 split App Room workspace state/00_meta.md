# 20260721A.003 Split App Room Workspace State

## 任务概括

拆分`src/App.svelte`的Home视图、Room连接/控制状态、runner snapshot/delta repair和notification delivery。`App.svelte`继续负责URL route、顶层页面切换、Workspace composition与唯一beforeunload dirty聚合。

## 正式 task 级别及定级原因

三星任务。

App连接HTTP与WebSocket两个ordering domain，并聚合controller、terminal、runner、content invalidation和browser-local dirty state。Svelte响应式依赖或generation guard移动错误会产生重连回滚、漏通知或丢失unload保护。

## 范围内

* 提取Home Room registry UI和其Svelte 5自动刷新生命周期。
* 提取Room workspace state与socket lifecycle orchestration。
* 提取runner delta merge/resync协调和notification browser delivery。
* 保留App顶层route/composition和dirty aggregation。

## 范围外

* 不改变URL、Room lazy-create/Home、controller或reconnect contract。
* 不改变runner protocol、terminal merge算法、toast和通知产品行为。
* 不改变Workspace、Macro、Library、terminal布局与样式。
* 不引入browser-to-browser同步或持久化live Room state。
