# Problem Context

## 问题

`.031A` 已有大量 unit、integration 和 Playwright 测试，但测试组织方式存在一个系统性缺口：许多 Macro/runner 场景先通过 HTTP API 创建 terminal、导入完整 JSON 或直接构造 runner fixture，然后只验证页面最后一小段 UI。这样的测试能证明 schema、server 和局部 component 工作，却不能证明真实用户能从空白界面完成同一任务。

这类缺口已经反复造成重构漂移：

* insertion test 可能把“没有 earlier artifact 时禁止插入 If”误当正确行为，因为它只验证自己预设的 fixture，而没有经历用户先插入 If、再补 source 的编辑过程；
* terminal 在 Macro 创建前后发生变化时，局部测试可能没有重新走 Target tab UI；
* action palette、collection controls、JSON lock、Prompt、Trace 和 runner 分散在不同 spec，没有一个 Gate 能证明它们组合后仍可完成真实工作；
* 新按钮可能没有任何测试，旧按钮也可能只检查 visible 而从未被点击；
* 代码重构后，测试 fixture 仍能绕过已经损坏的 UI，所以 Gate 通过但用户操作失败。

## 目标用户旅程

测试以一个全新的 config URL 开始。它像真实用户一样：

1. 通过 topbar 创建 fake、real shell 和 text terminals；
2. 操作 terminal tab、rename、keyboard select、drag reorder、Text editor、copy、panel resize 和 Settings；
3. 通过 Macro panel 的 New 和 visual insertion palette 从零构建复杂 Macro；
4. 在编辑过程中实际使用全部 action/flow palette、结构按钮、collection controls、branch controls、template controls 和 validation；
5. 保存、切换、搜索、Export/Import、JSON Edit/Cancel/Save；
6. 运行 Macro，在多个 terminal 输出并 capture，经历 Pause/Resume、waiting input、runtime input submit、Stop 和 completed run；
7. 在 Trace 中查看 run、node events、artifact preview、AI Trace copy 和 debug controls；
8. 操作 Prompt panel 的 project/global CRUD、search、copy、scope move 和 delete；
9. 清理临时 Macro/Prompt/terminal，验证 cancel 与 accept 两条 destructive path。

整个流程只使用 loopback server 和本机进程，不运行 Codex、不调用外部网络。

## 为什么需要 control inventory

单纯写一条很长的 E2E 仍可能遗漏按钮。`.031B` 因此把 UI controls 当成显式 contract：

* source audit 找出所有非 Codex interactive controls；
* inventory 为每个 semantic control 指定稳定 key、操作证据和必要状态；
* runtime journey 记录实际被操作的 control key；
* 测试末尾比较 required inventory 与 evidence，漏点、删点或无归属新增都会失败。

后续 task 可以合理更新 inventory，但更新必须和产品 contract 变化一起发生。仅因 selector 变了、测试难写或实现重构而删除覆盖，不构成合理更新。

## `.031B` 与后续重构的关系

`.031B` 是 baseline revision，不是永远不变的测试副本。正确演进方式是：

```text
.031B:
  冻结 .031A 行为 A/B/C

.032:
  spec 明确删除 B
  -> 更新测试：移除 B，并记录 changedBy=.032
  -> A/C 仍必须通过

.033:
  只重构实现，没有改变 A/C
  -> 不得改掉 A/C 的断言
```

因此“基线冻结”和“后续合理更新”并不矛盾；前者防止无出处漂移，后者允许产品设计真实演进。
