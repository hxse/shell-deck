# Problem context

## 使用场景

目标场景不是让 Parallel 强制返回一段合并文本，而是把它当成几个线性 pane 的并发编排器：

```text
Parallel
├─ lane_1: Send Shell 1 → Capture Shell 1 → Send result to Text 3
├─ lane_2: Send Shell 2 → Capture Shell 2 → Send result to Text 3
└─ lane_3: Send Shell 4 → Capture Shell 4 → Send result to Text 3

Parallel 外
└─ Capture Text 3 → If
```

Parallel 自然等待所有 pane 结束，随后执行外部节点；这里没有需要用户配置的 Join 节点。Text 3 是普通 Room terminal，用户可以在 Parallel 前后自行编辑或清理，runner 不替用户管理其“干净状态”。

## 当前痛点

现有 Parallel 把 terminal 放在 lane header，lane 内 Action 隐式继承它；每条 lane 又必须以固定 Output 结束，parent 再生成 `merged_text`。这让一个 pane 无法先操作 Shell、再把 capture 发送到 Text，也把 UI 挤成 Lane tab、Lane terminal、Lane result、Collect、Output 和 Merge 多层配置。

强制 Output 还制造了错误边界：Parallel 被建模成一个“返回 text 的特殊函数”，而不是普通 Action 的并发容器。用户真正想消费的是实时写入的 Text terminal，`merged_text` 只是重复真值。

## 设计初衷

Parallel 只拥有两项并发职责：

1. 同时推进多个线性 pane，并在全部结束后自然回到外部 Flow。
2. 当多个 pane 向同一个 Text append 时，提供一个清楚、可验证、不会交错写乱的队列。

Action 的 terminal、artifact 和 side effect 继续遵守普通 Flow 语义。Parallel 不自动清空 Text、不延迟到全部 pane 结束后统一 flush，也不回滚已经发生的 side effect。

## 方案对比

保留 final Output 再扩展 target，看似改动较小，但仍要求每条 pane 产出 text，不能表达多个中间 Send，也保留两套结果真值。

先 stage 所有结果、全部 pane 成功后统一写 Text，顺序简单，却失去实时可见性；Pause、Fail 或 Stop 时用户也看不到已经完成的部分。

为 shared Text 建 mutex 可以避免字节交错，但不能表达默认的 pane 顺序；锁的获得顺序仍由实际完成时序决定。

最终选择 per-action terminal 加 per-target queue。completion order 在 Send 触发时立即 append；pane order 把尚未轮到的 Send 放入 ready queue，当前序号到达后立即 append，并连续 drain 已就绪的后继。它同时保留实时性、明确顺序和 partial visibility。

## 取舍结论

实现固定分成三层：

* pure terminal usage policy 从冻结 definition 推导 Shell owner、Text exclusive/shared 与每个 shared Text 的 Send plan，是 validator 和 UI 的单一规则源。
* invocation-local shared Text queue 只拥有 per-target cursor、ready payload 和 waiter，不拥有 runner 或 Room state。
* Parallel executor 只协调 pane lifecycle、Pause/Fail/Stop，并把实际 terminal append 委托给 queue。

这种边界让 schema/validation、authoring 提示和 runtime 顺序共享同一语义，同时不把普通 terminal mutation、artifact evaluation 或 runner lifecycle塞进队列。
