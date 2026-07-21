# Problem Context

`MacroStepList.svelte`与`ParallelLaneTabs.svelte`包含相似Action字段，却又有不同scope：root/branch能引用outer earlier outputs，lane能引用outer加lane-local earlier outputs，lane output则有自己的规则。组件还承担递归布局、折叠与插入命令。

按Action类型盲目抽成大量微组件会造成props爆炸；把所有字段改成schema-driven renderer又会改变UI。本任务选择中等粒度：共享真正相同的field editor和pure choice/default logic，保留root与lane composition显式可读。
