# 问题背景

## 使用场景与痛点

用户在Macro Visual editor里编辑Send正文、matcher、label等普通文本时，按住字符键或连续退格会明显落后于键盘输入。编辑Node ID时问题更严重：第一个字符进入后输入框就失去焦点，看起来像系统自动保存并中断了编辑。

这些现象来自同一条共享链路的不同层次。每次Visual mutation都会深拷贝整个Macro definition、替换draft根对象，再重复序列化当前值与base值判断dirty。于是一个字符会让递归编辑树看到全新的对象图并重新计算依赖。Node列表又曾把正在编辑的`node.id`直接作为Svelte keyed-each identity；即使外层改用node object，For(text-list)也一度继续用包含父`node.id`的派生key。ID变化会重建对应编辑器或全部text-list item row，造成焦点中断、与item数量相关的额外开销，并丢失textarea本地布局/滚动状态。

## 设计目标

Visual editor应像正常原生表单一样连续输入：事件同步进入唯一Macro draft，字段本身不因值变化被重建，用户显式点击Save前不产生保存请求。优化必须落在共享mutation与编辑器identity边界，而不是给几十个字段分别增加本地缓存、debounce或特殊处理。

## 方案对比

候选一是给每个输入框维护local buffer，在blur或定时器到期后写回draft。它能隐藏部分卡顿，却会制造大量第二真值，并引入blur、切换Macro、Save、Start和unload时谁先flush的问题。

候选二是保留整树copy-on-write，但为每种字段实现path-aware结构共享。它可以保持旧的根对象替换模型，不过需要重写所有mutation command，复杂度和回归面远超本次性能修复。

候选三是利用Svelte 5 deep rune state：已通过guard的Visual mutation直接修改现有draft proxy，只递增既有revision；base definition的稳定序列化结果在安装record时缓存，按键时只序列化当前draft做精确dirty比较。递归节点使用node object，For(text-list)行使用item object作为当前editor identity；两者都不从persisted ID派生DOM key。

## 取舍结论

采用候选三。它保持`createMacroRecordSession`是唯一draft owner，保留同步mutation、精确dirty、显式Save和现有command接口，同时从根因上移除每次按键的整树clone/root replacement及editable-key remount。字段值仍直接来自正式draft，不引入延迟提交或丢失最后一次输入的新状态机。
