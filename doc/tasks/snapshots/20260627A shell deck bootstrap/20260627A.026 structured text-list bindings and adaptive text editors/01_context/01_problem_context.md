# Problem Context

## 用户场景

.025 已把用户手写的重复 send/capture 流程收敛为可暂停恢复的 text-list loop，但每轮只有一个匿名 text。实际阶段式工作需要同时引用：

* 当前顺序，用于“阶段 1 / 阶段 2”。
* 用户可编辑名称，用于“高频策略 / 边界策略”等稳定说明。
* 可包含多行的正文，用于真正发送或显示的内容。

现有 Item 1、Item 2 只是不可编辑的 card label，不能承担用户 key。把自动序号改成可编辑值又会让重排后的位置语义和 identity 混在一起，因此需要把位置 index 与用户 key/value 分离。

同时，Message Text 等 multiline editor 当前用固定 rows/min-height 起步，并没有真实 max-height；用户短文本也一直占用较高空间。理想行为是按当前视觉内容再预留一行自动增长，到自动上限后滚动，同时允许用户临时拖大查看更多内容。

## 用户明确决策

本任务采用 hard cut：

* 优先破坏性更新。
* 不兼容、不读取、不处理旧 text-list/template 语法。
* 不写 alias、migration、Convert、dual schema 或 legacy branch。
* index 只输出纯数字，不带 #、Item、空格或其它装饰。
* textarea 保留 vertical resize；手动高度只在当前组件生命周期生效，不持久化。

这些决策同时写入项目 AGENTS.md，成为后续 task 的默认演进原则；只有用户在具体 task 明确要求兼容时才能例外。

## 采用方案

继续使用唯一 for mode 名 text-list，直接替换其 item shape：

~~~ts
type TextListItem = {
  key: string
  value: string
}

type TextListRange = {
  kind: "text-list"
  items: TextListItem[]
}
~~~

index 是当前数组位置的 1-based 展示值，不存 JSON。key 是用户内容而非 identity；value 是 multiline 正文。三者形成每轮不可变 binding，供 {{index}}、{{key}}、{{value}} 使用。

Template capability 仍只属于 .025 冻结的六类 runtime content。数据源 key/value 不模板化；普通 literal 中的双花括号仍按普通字符保存。

Textarea 使用两个层次：

1. auto height 根据实际 scrollHeight 加一行计算，并限制在各 surface 的 autoMaxRows。
2. 用户 native vertical resize 形成 temporaryManualHeight；最终高度取 auto 与 manual 的较大值。手动高度可以突破 auto cap，但受 60vh hard cap。

这样短文本紧凑，长文本不会自动撑爆 panel，用户需要时仍可临时展开。

## 文档关系

.025 snapshot 记录当时 string[] 和 {{text}} 的历史交付，不回写。.026 的 02_spec 在实现 Close Gate 前是当前任务真值；实现与验证完成后再同步 macro active spec、run-log active spec 的相关段落和 quickstart。
