# 20260723C.011 Split Parallel Lane Policy and Stateful Controller

## 任务概括

`parallelLaneEditorController.svelte.ts`当前423行，把两个local rune、definition lookup、terminal capability policy和全部lane/action/output mutation放在一个controller。本task抽pure policy/commands，controller保留唯一UI state和mutation gateway。

## 正式 task 级别及定级原因

三星任务。Parallel要求distinct terminal、capability-compatible action、final single Output和lane-local artifact source；ID rename还要同步collapse/selection。错误可能生成可保存但运行错误的draft或让UI状态指向旧ID。

## 范围内

* 新建pure Parallel lane policy模块。
* 新建pure command模块或等价pure command section。
* stateful Svelte controller继续唯一拥有collapsed IDs与edit notice。
* 每次definition mutation继续只进入parent提供的`updateDraft`。

## 范围外

* 不改Parallel schema/default、validation、component DOM或palette。
* 不把draft缓存到controller/policy。
* 不建立generic node command framework。
