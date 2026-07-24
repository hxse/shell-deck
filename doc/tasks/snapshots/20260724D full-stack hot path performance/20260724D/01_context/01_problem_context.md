# 问题背景

## 当前瓶颈

`20260724C`已经移除Visual字段每次输入时的完整draft clone/root replacement，但当前一次Visual mutation仍会在`MacroPanel`、`macroRunnerSession`和runnable wrapper中重复遍历definition，并由validation success clone、dirty fingerprint和JSON projection继续制造全树工作。大Macro下，这些同步工作仍直接占用input event的frame budget。

AgentEvent store在每次append时读取、解析并严格验证整份JSONL来检查event ID；capture wait每100ms又通过`matching`、`countMatching`和`nextMatching`重复扫描。日志增长后，这些同步I/O与解析发生在同一Bun event loop，会影响HTTP、WebSocket和PTY，而不只影响capture。

Text terminal当前每次accepted edit都发送完整正文；server替换完整replay并向每个client广播完整terminal snapshot。正文大小、client数量和按键频率相乘后，inbound、server encode、outbound、browser parse/render都线性放大。Text没有正文大小上限，现有全量协议与产品能力不匹配。

terminal move和close在`terminal_index_map`之后又广播包含全部terminal replay的`room_snapshot`；Prepare循环中的move/create会重复同类projection。Room结构变化本应只携带结构真值和新terminal最小初始化数据。

Runner每次publication先构造含完整definition与retained event window的snapshot，再裁剪delta；delta仍重复definition。Trace则扫描全部run manifest并一次返回每个匹配run的完整event tail。长期运行后会同时放大CPU、network、memory和同步disk scan。

此外，artifact source choice从每个node重新从root DFS，两个line-number gutter按总行数创建DOM，WebSocket send queue用数组`shift()`并重复计算出队payload字节数。这些不是正常规模主瓶颈，但会放大AI生成大Macro、长文本和backpressure。

## 已拍板设计

Text采用最长公共前缀/后缀产生的一次连续replacement patch；patch接近全文时使用replace。browser本地输入立即生效，只有network/hash/layout副作用被throttle。协议只保留`expectedTextRevision`与合并后完整正文的`resultHash`；revision或hash不一致时single-flight请求full snapshot，full snapshot再次不一致则fail loudly。

Runner的definition在run-start/full repair snapshot发送并hash一次；普通delta只发送mutable runtime state、新events、`expectedRuntimeRevision`、`definitionHash`和合并后完整逻辑状态的`stateHash`。client合并后验证hash，失败复用full snapshot repair。不会引入event chain或Merkle。

Trace采用cursor-paginated run summaries；选择run后再cursor-paginate该run retained events。每run durable retention仍为最近约1000条event；completed run、artifact和AgentEvent总量不在本任务自动删除。

## 方案取舍

Text若继续full正文同步，只能靠大小上限与debounce掩盖成本，并会把Text正式降级为bounded scratchpad；本任务选择单段patch，因为它已能覆盖输入、删除、粘贴、Undo与整段替换，又不需要OT/CRDT。Runner若保留definition-in-delta，只优化clone/cache仍无法解决多client带宽放大；因此definition改为snapshot-only。Trace若只保留最近固定N个run实现更简单，但会失去已有历史浏览能力；两级pagination在不改变retention policy的前提下给response和DOM建立了明确上界。

完整hash不替代revision：revision判断基线与顺序，hash验证增量合并后的全量结果。只保留result/state hash而不再增加base hash、event hash chain或Merkle，可以满足一致性校验，同时把协议和状态机维持在可审阅范围内。

## 约束与不变量

Macro仍只有一份deep rune draft，validation issue code/path/order、explicit Save/Prepare/Start、content lease和controller guard保持。Text仍是single-controller Room terminal，不建立OT/CRDT。PTY Shell replay的2MiB tail contract不变。AgentEvent append必须先完成file durability再发布给waiter。run evidence event sequence、segment retention、manifest/definition hash和artifact contract不变。

所有新协议按current-schema-only直接替换，不保留旧`set_terminal_text`、旧Runner delta或旧aggregate Trace response。旧client/input必须fail loudly。所有project-authored source继续不超过400行，重命令按顺序执行。
