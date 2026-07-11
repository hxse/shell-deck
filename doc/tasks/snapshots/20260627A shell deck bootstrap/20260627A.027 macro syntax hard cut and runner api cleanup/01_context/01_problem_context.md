# Problem Context

## 问题是什么

项目已经明确采用 current-schema-only，但审查发现 count loop 仍保留两种等价写法：

~~~json
{ "count": 3 }
{ "kind": "count", "count": 3 }
~~~

第二种是当前 UI 生成的 canonical 形态，第一种却仍被 type、validator、store、editor 和 runner 全链路接受。Active spec 甚至明确写着“旧形态可以读取”。这意味着“新建时写新语法”并没有真正完成破坏性切换。

同一次审查还发现两个同根问题：

* TerminalRef 只读取 `kind/value`，但不拒绝额外字段；旧字段可以夹带并被原样持久化。
* Runner control HTTP API 仍接受被忽略的 `nextStepId` 和已经无效的 mock fields；调用者收到成功语法解析，却无法获得它以为自己请求的语义。

根因不是某个 if 写错，而是边界仍采用“能识别就尽量接受”的风格，和项目现在的 fail-fast contract 冲突。

## 用户明确决策

本任务采用破坏性更新：

* Macro 写法只保留唯一 current form。
* 不兼容、不读取、不解释、不迁移旧写法。
* 旧输入在最早可判定的公开边界 fail loudly。
* 不为了更友好的旧语法错误文案，在 production validator 保留旧名字 kill list。
* 测试可以保留旧输入作为 negative evidence，但不得再有旧写法 positive fixture。

## 方案选择

### 方案 A：只保证新 UI 写 canonical

继续读取 `{count}`，保存时可能仍原样 round-trip。改动小，但 dual schema 永久存在，拒绝。

### 方案 B：读取旧写法后自动重写

可以减少用户手工处理，但会引入 migration、rewrite 时机、失败恢复和版本边界，违反用户已冻结的破坏性原则，拒绝。

### 方案 C：所有入口 hard cut

Type、validator、store、HTTP、runner 和 editor 同时只接受/生成一种形态；旧文件直接 invalid。TerminalRef 和 runner request 同样 exact-key。该方案失败最早、真值最少，是本任务采用方案。

## 为什么 runner API 一起收口

`resume.nextStepId` 与 occurrence cursor 是互斥的恢复模型：前者暗示调用者能指定恢复点，后者规定恢复点只来自 server-owned cursor。继续接受但忽略参数比明确失败更危险。

Start mock fields 同样已没有执行消费者。它们虽不在 template JSON 中，却属于同一个 Macro 公开控制面，适合在本次 breaking task 一起删除。

## 为什么不改 run-log 和 terminal 字段名

旧 run-log replay 涉及历史追溯数据，删除它会改变 append-only evidence 的可读范围，不能被“宏写法清理”顺手带走。

`terminal` 当前也没有第二套 JSON alias；Target/Source/Lane 是 UI label，而非待迁移字段。没有用户指定的新字段设计时，重命名只会制造另一轮语法分叉，因此保持不变。

## 文档关系

`.017` 冻结了缺少 count discriminator 的兼容写法；`.025` 建立 occurrence cursor；`.026` 写入 current-schema-only 原则。本任务只在新的 `.027` change 中破坏性收口当前 truth，不回写历史 snapshot。实现 Close Gate 后同步 Macro active spec、quickstart 和 task index。
