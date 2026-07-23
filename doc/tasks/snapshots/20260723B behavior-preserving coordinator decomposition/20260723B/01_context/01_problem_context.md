# Problem Context

## 已确认的问题

### Terminal Room manager

`server/terminalRoomManager.ts`仍有1158行、约83个方法，并被25个文件消费。它同时承担Room registry、client/heartbeat、controller lease、mutation ticket、terminal CRUD、backend callback、cwd refresh和broadcast。`20260721A.008`已拆出部分runtime/projection实现，但入口尚未达到其“唯一公开薄facade”目标。

### Macro与Library record session

`macroRecordSession.svelte.ts`与`librarySession.svelte.ts`分别约926/983行。两个factory都应继续作为唯一rune state owner，但当前各自把navigation/catalog、CRUD、content lease、operation identity、remote invalidation/retry、published-Create preservation与UI feedback压在一个大闭包中。saved-content race和reconnect路径难以局部审阅。

### Macro flow/lane editor

`MacroFlowNodeList.svelte`与`ParallelLaneTabs.svelte`分别约696/607行，既渲染递归UI，又维护tree/lane mutation与floating insertion palette。两处各自实现viewport placement、clamp、focus、Escape与restore-focus，同一interaction contract存在两份真值。

### 已在前置change解决

`scripts/checkUiStyleResidue.ts`原先527行并混合Svelte AST、Macro policy与CSS parser。该finding已在`20260723A`内解决：78行原入口只保留facade/CLI，四个policy/helper模块承担唯一实现，因此不重复进入本链。

## 为什么必须串行

四个child都依赖当前完整Gate，但彼此不需要在同一个不可审阅diff中同时移动。Terminal先稳定server boundary；Macro和Library分别处理各自domain，明确禁止抽取generic shared session；最后在session边界稳定后移动Svelte editor local state与focus lifecycle。每个change只承接一个ownership问题，后继change基于前继已验证状态自动重基。

## 风险模型

* callback、await或publish位置的机械漂移改变controller/lease时序。
* coordinator复制state，产生第二真值或stale snapshot。
* Macro/Library为了“复用”而模糊两套不同的Create、navigation和remote reconciliation contract。
* palette移动后DOM不变但focus、Escape、resize clamp或restore target改变。
* 只以行数下降为成功标准，却把复杂度搬进同样巨大的匿名闭包。

因此成功标准是ownership和dependency方向清晰、入口变薄、重复实现消失，并且现有行为oracle原样通过；不是追求任意行数阈值。
