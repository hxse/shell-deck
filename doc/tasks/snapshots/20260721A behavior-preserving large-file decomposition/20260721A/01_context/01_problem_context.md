# Problem Context

## 当前问题

shell-deck经过多轮功能收口后，若干文件同时承担transport、state machine、validation、UI orchestration和竞态协调。代码当前可以工作，但继续在同一文件叠加功能会提高以下风险：

* 一个局部修改需要理解整份超大文件，审阅边界不清。
* server/client两个ordering domain的防御逻辑容易被无关UI修改破坏。
* Macro与Library的复杂异步会话被组件markup淹没，竞态测试难以准确对应实现。
* runner与Terminal Room manager同时混合lifecycle、runtime state、projection和I/O。
* CSS与current E2E逐步变大后，视觉回归和行为回归难以定位归属。

## 为什么现在拆

20260627A.032-.037已经完成Room、controller、content lease、portable Macro、server-authoritative runtime sync、Library和Unassigned reference的主要语义切换。此时应先稳定模块边界，再继续增加功能。

拆分不是重新设计。当前源码、active specs与已通过的current Gate仍是行为真值；新模块只重新分配ownership，不能改变结果。

## 风险模型

本轮主要风险不是编译错误，而是“看起来等价”的细微漂移：

* route匹配顺序、authorization时点或publish point改变。
* validation issue的path/code/order改变。
* Svelte响应式依赖、await continuation guard或beforeunload dirty聚合改变。
* UI DOM层级、CSS cascade、focus和click feedback改变。
* runner event顺序、terminal revision、pause/stop/cancel边界改变。
* 测试拆分后遗漏原断言，形成虚假的绿色Gate。

因此每个子任务必须先冻结外部观察面，再做移动，并以原测试加针对模块边界的结构测试证明没有漂移。
