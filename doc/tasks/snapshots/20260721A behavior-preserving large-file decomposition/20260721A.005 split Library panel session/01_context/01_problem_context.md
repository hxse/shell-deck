# Problem Context

LibraryPanel将三个kind、两个scope、搜索列表和一个复杂编辑会话放在同一组件。navigation不是简单赋值：离开saved record前可能释放lease，await期间用户又能触发New/Select；remote Save/Delete也可能与本地Create/Save response交错。

本任务要把“选择去哪”和“当前draft能否被替换”分别建模，同时保持同一个operation generation domain。Search只投影authoritative summaries，不应拥有selection或编辑状态。
