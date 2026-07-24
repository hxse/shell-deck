# 20260724D Full-stack Hot Path Performance

## 任务概括

收敛shell-deck当前会随Macro、AgentEvent、Text正文、terminal replay、run数量或WebSocket积压线性放大的同步热路径。Text terminal与Runner live projection改为`revision + incremental mutation + merged full-state SHA-256`，Trace改为两级cursor pagination；同时移除Visual Macro重复validation/clone/stringify、AgentEvent全日志轮询、Room结构操作重复全量replay、artifact choice重复DFS、全量行号DOM和send queue `shift()`。

## 任务级别

三星任务。任务改变Text terminal、Runner live delta和Trace HTTP的current protocol，并触及Macro validation truth、AgentEvent durable append/wait、Room多client projection和run evidence读取；顺序、hash或repair错误可能造成quietly wrong正文、runner状态、capture结果或跨client视图。

## 范围

范围内：Macro trusted live-draft diagnostics与exact dirty journal；AgentEvent冷加载索引和event-driven waiter；Text单段replacement patch、100ms leading/trailing throttle、single-flight/latest coalescing、SHA-256校验与full repair；line-number virtualization；Room结构projection和single-encode broadcast；Runner definition-once delta、state hash和terminal cache eviction；Trace run summary/event pagination与derived room index；artifact choice index和WebSocket deque；focused scale/work-count测试；active spec和Quickstart同步。

范围外：改变MacroDefinitionV5、AgentEvent或run evidence持久化schema；引入兼容旧live protocol的dual branch；自定义Web Worker、Merkle tree、event hash chain或复杂text operation tree；删除历史run/evidence、限制completed run/artifact/AgentEvent总量；把Text扩展成多人协作编辑器；重做Macro/terminal视觉语言。
