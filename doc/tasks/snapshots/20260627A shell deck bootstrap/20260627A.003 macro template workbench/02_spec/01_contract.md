# Contract

## 任务边界

本任务交付宏模板工作台。完成后，用户可以创建、编辑、复制、删除、导入、导出 macro template，并从 V0 内置 parser profile 中选择一种 profile，但还不能真正运行宏。

范围内：

* macro template schema validation。
* `ai-json` parserProfileId 引用、template-local `regex` parser config 和 `ProfileCatalogSummary` 最小 stub。
* 浏览器侧面板基础 CRUD。
* 模板缓存和导入导出文件格式。
* terminal ref 支持 current index、stable id 和 terminal tab alias 三种写法；alias 来自终端 tab 重命名，不在 macro template 内另存映射。
* `capture-source` step 配置，V0 默认是 `terminal-buffer` 原始 TUI capture，也支持 `agent-event`，Codex 通过 `codex-stop-hook` adapter 产生该事件；用户显式选择 source，系统不自动判断哪种更正确。
* parse step 支持 `ai-json` 内置 parser profile 和 template-local `regex` rules 两种方式。

范围外：

* macro run state、event log 和 runner。
* parser 实调用。
* 用户自定义 parser prompt。
* Codex session 自动发现或自动恢复。

## 任务规范

### 持久化 layout

V0 使用项目本地 `.shell-deck/`，并按 config 隔离。`configId`、`templateId`、`deckId`、`stepId`、`captureStepId` 和 alias 必须遵守 root `Identifier Contract`，并在参与路径拼接前完成校验：

```text
.shell-deck/
  configs/
    <config-id>/
      config.json
      templates/
        <template-id>.json
      decks/
        <deck-id>.json
```

同一个 server 可以打开多个 config。template、deck config 默认属于某个 `configId`。本任务冻结 `ProfileCatalogSummary` 最小 stub，供 UI 选择 profile 和校验 branch declared signals；完整 parser profile bundle 由 `20260627A.007` 提供。导入/导出 template 可以跨 config 复用，但导入后必须重新在目标 config 下验证 terminal refs。

本任务只负责 templates、profile 引用、`ProfileCatalogSummary` stub 和必要 deck config。run log 在 `20260627A.004` 实现，完整 ParserProfile bundle 在 `20260627A.007` 实现。

### TerminalRef

Macro template 里引用 terminal 使用 `TerminalRef`。规范写法有三种：

`kind=index` 是方便写法，运行时在当前 `configId` 下按实时 terminal order 动态解析为 `terminalId`：

```json
{ "kind": "index", "value": 3 }
```

`kind=id` 是稳定写法，直接绑定某个 live terminal identity，不受 tab 位置变化影响：

```json
{ "kind": "id", "value": "term_7k3p9d" }
```

`kind=alias` 引用当前 config 内 terminal tab 的名字。alias 的唯一真值是 terminal tab 重命名结果，macro template 不保存 `terminalAliases` 映射表：

```json
{ "kind": "alias", "value": "reviewer" }
```

UI 可以提供简写输入或下拉选择，但保存到 JSON 时必须归一化成显式对象，避免 alias、id、普通字符串混淆。导入模板到新 config 后，`kind=alias` 和 `kind=id` 必须重新按目标 config 校验；找不到目标时不能静默降级成 index。

### ParserProfile reference

Macro template 的 parse step 必须保存结构化 parser 配置。`ai-json` parse 保存 `parserProfileId`，不能保存 prompt、schema、checkSet、fixtures 或自定义 AI prompt；`regex` parse 保存 template-local regex rules，不调用模型。

本任务的 UI 必须读取 `ProfileCatalogSummary` stub，用于展示 profile 名称和限制 branch 条件。`ProfileCatalogSummary` 只允许包含：

* `profileId`
* `name`
* `description`
* `parserKind`: V0 对内置 profile 固定为 `ai-json`
* `signals`: typed signal summaries，包含 `id` 和 `type`
* `branchOperators`

完整 ParserProfile bundle，包括 prompt、JSON Schema、checkSet、fixtures、replicas 策略和 fixture eval，由 `20260627A.007 parser profiles and adapters` 交付。

V0 不支持用户自定义 parser prompt。后续如果支持用户自定义，需要单独任务设计 prompt/schema/checkSet 的整体导入、验证和版本管理。


### ProfileCatalogSummary stub

为解决 `.003` 早于 `.007` 的顺序依赖，本任务必须冻结一份最小 profile catalog summary stub。它是 UI/schema 的薄真值，只用于：

* profile 下拉选择。
* `ai-json` `parserProfileId` reference validation。
* branch condition signal id 和 value type 校验。
* branch operator 限制。

它不能包含 prompt、JSON Schema、checkSet、fixtures、replicas、模型名或 parser invocation 配置。这些完整 ParserProfile bundle 仍由 `.007` 交付。

V0 最小 summary shape：

```json
{
  "schemaVersion": 1,
  "profiles": [
    {
      "profileId": "review-routing-v1",
      "name": "Review Routing",
      "description": "Route review output into user decision, AI-fixable work, or clean/P3-only completion.",
      "parserKind": "ai-json",
      "signals": [
        { "id": "hasAiFixable", "type": "boolean-null" },
        { "id": "needsUserDecision", "type": "boolean-null" },
        { "id": "onlyP3OrClean", "type": "boolean-null" }
      ],
      "branchOperators": ["==", "!=", "is_null"]
    },
    {
      "profileId": "review-full-v1",
      "name": "Full Review Summary",
      "description": "Summarize P1/P2/P3 review findings for macro routing.",
      "parserKind": "ai-json",
      "signals": [
        { "id": "hasP1", "type": "boolean-null" },
        { "id": "hasP2", "type": "boolean-null" },
        { "id": "hasP3", "type": "boolean-null" },
        { "id": "hasAiFixable", "type": "boolean-null" },
        { "id": "needsUserDecision", "type": "boolean-null" },
        { "id": "onlyP3OrClean", "type": "boolean-null" }
      ],
      "branchOperators": ["==", "!=", "is_null"]
    },
    {
      "profileId": "claims-safety-v1",
      "name": "Claimed Safety Signals",
      "description": "Extract claims from agent text without treating them as system audit truth.",
      "parserKind": "ai-json",
      "signals": [
        { "id": "claimsFileWritten", "type": "boolean-null" },
        { "id": "claimsNonReadonlyJj", "type": "boolean-null" },
        { "id": "claimsTestsRun", "type": "boolean-null" }
      ],
      "branchOperators": ["==", "!=", "is_null"]
    }
  ]
}
```

`.007` 必须读取或生成与这份 summary 兼容的完整 ParserProfile bundle。若 `.007` 需要改 `profileId`、`signals.id`、`signals.type` 或 `branchOperators`，必须写迁移说明，不能静默让 `.003` 保存过的模板失效。

`regex` parse step 不使用内置 ParserProfile bundle，但必须在 step 内声明自己的 typed output signals。branch validator 对 regex parse 使用该 step 的 `signals`，规则和 `ai-json` profile 相同。

### Macro template

模板至少包含：

* `schemaVersion`
* `id`
* `name`
* `description`
* `configId`
* `steps`
* `createdAt`
* `updatedAt`

模板不允许包含顶层 `terminalAliases` 或 `captureSources`。`terminalAliases` 会制造第二份 terminal 名称真值，必须改为 terminal tab rename；`captureSources` 必须下沉到 `capture-source` step，让 capture 成为可追溯、可排序、可记录的普通步骤。

step 需要有稳定 `id`、`type` 和对应配置。terminal 引用必须保存为 `TerminalRef` 对象，可以使用 index、stable id 或 terminal tab alias。运行时所有引用都在当前 `configId` 下解析成 `terminalId`。

`capture-source` step 描述 parser 或 wait step 从哪里拿文本，不保存 Codex session。V0 必须支持两类 source：`terminal-buffer` 和 `agent-event`。`terminal-buffer` 是默认值，直接从指定 terminal 的 replay/scrollback/screen buffer 截取原始 TUI 文本；`agent-event` 用统一 `AgentEvent` 过滤条件获取结构化 agent callback，例如 `agentKind: "codex"`、`eventKind: "agent.output"`、`adapter: "codex-stop-hook"`。运行时具体映射到哪个 Codex `session_id` 属于 deck/run state，不能写进 macro template。macro runner 对 `agent-event` 只按 `AgentEvent` 的 `configId`、`terminalId`、`agentKind`、`eventKind` 匹配，不直接消费 Codex hook 字段。

### Step types

V0 macro template 至少必须能结构化保存这些 step，不保存自由文本 DSL：

* `send_line`：向 resolved terminal 写入 `text`，然后发送 Enter。宏不区分 prompt、shell command、REPL 输入或 Codex 输入。
* `wait`：使用结构化 WaitStep schema 等待 duration、capture-ready-or-user、terminal-quiet 或 user-continue；wait 不生成 capture artifact。
* `sleep`：睡眠一段时间。模板存储统一使用 `durationMs` 正整数；UI 可以让用户输入 ms/s/min/h，并在保存前转换成毫秒。
* `input_line`：进入 `waiting_user_input`，显示类似 Python `input()` 的单行输入框；用户输入并回车后，runner 把该文本作为一行发送到指定 terminal，再继续 next step。
* `capture-source`：按用户选择的 source 生成 capture artifact；它是 V0 唯一的 capture artifact producer。
* `parse`：读取同一 run 内对应 `captureStep` 最近一次已完成 `capture-source` 产出的 capture artifact，使用 `ai-json` 或 `regex` parser 输出 typed signals。
* `branch`：结构化 if/else，根据 normalized typed signals 选择 next step，可以作为简单循环的停止判断。
* `goto`：无条件跳转。V0 允许跳到前面某一步形成简单循环，但任何回跳必须声明 `loopGuard`。
* `pause`、`complete`、`fail`、`stop`：显式状态控制。
* `parallel_all`：由 `20260627A.008 bounded parallel lanes` 扩展；不属于 `.003` Close Gate，`.003` 不需要执行或校验 lane schema。

`input_line` 只提供等待用户输入并转发的工具，不理解“用户拍板”等业务语义。是否跳到 `input_line` 完全由用户配置的 branch 条件决定。完整 `for_each`、item binding、嵌套循环、`break` 和 `continue` 不进入 V0，留给 V1 单独设计。

### WaitStep

V0 `wait` step 必须使用结构化 schema，不保存自然语言 wait condition。最小支持四种 mode：

```json
{ "type": "wait", "mode": "duration", "durationMs": 1500, "next": "next-step" }
```

```json
{ "type": "wait", "mode": "capture-ready-or-user", "captureStep": "capture-review", "timeoutMs": 600000, "onTimeout": "pause", "next": "capture-review" }
```

```json
{ "type": "wait", "mode": "terminal-quiet", "terminal": "review", "quietMs": 1000, "maxMs": 600000, "onTimeout": "pause", "next": "capture-review" }
```

```json
{ "type": "wait", "mode": "user-continue", "prompt": "确认后继续", "next": "next-step" }
```

规则：

* `duration.durationMs`、`capture-ready-or-user.timeoutMs`、`terminal-quiet.quietMs`、`terminal-quiet.maxMs` 都存储为毫秒正整数。
* `capture-ready-or-user` 订阅或等待 selected `capture-source` step readiness；用户也可以手动继续。它不写 capture artifact；后续对应 `capture-source` step 才生成 artifact。超时按 `onTimeout` 执行，V0 `onTimeout` 支持 `pause` 或 `fail`。
* `terminal-quiet` 的语义是 resolved terminal 连续 `quietMs` 没有新的 pty output，且总等待不超过 `maxMs`。超时按 `onTimeout` 执行。
* `user-continue` 只等待用户点击继续，不读取 terminal 或 capture source。
* wait start、timeout、manual continue 和 completion 都必须写 event log。

### ParseStep

`parse` step 不调用 source adapter，也不隐式生成 capture artifact。它读取同一 run 内对应 `captureStep` 最近一次已完成 `capture-source` 产出的 artifact；若不存在可用 artifact，runner 必须 pause/fail 并指出缺失 capture step。

`ai-json` 示例：

```json
{
  "id": "parse-review",
  "type": "parse",
  "captureStep": "capture-review",
  "parser": {
    "kind": "ai-json",
    "profileId": "review-routing-v1"
  }
}
```

`regex` 示例：

```json
{
  "id": "parse-ready",
  "type": "parse",
  "captureStep": "capture-review",
  "parser": {
    "kind": "regex",
    "rules": [
      {
        "signal": "hasReadyText",
        "type": "boolean-null",
        "pattern": "ready|done|complete",
        "flags": "i",
        "onMatch": true,
        "onNoMatch": false
      }
    ]
  }
}
```

Regex V0 使用 ECMAScript RegExp，允许 flags `i`、`m`、`s`、`u`，不允许代码执行或字符串表达式。Regex raw match 和 normalized result 都必须写 artifact。`boolean-null` 的 regex rule 最终只能输出 typed `true`、`false`、`null`。

`parse` step 必须明确 `parser.kind`。`ai-json` parser 引用一个内置 `parserProfileId`；`regex` parser 在模板内声明 regex rules 和 typed output signals。`branch` step 的 `conditions` 必须使用结构化 `BranchCondition` 对象，不能保存 `signal == value` 这类字符串表达式。UI 必须阻止用户引用 selected parse step 不会输出的 signal。


### BranchCondition

V0 macro template 不保存字符串表达式，不支持 JS eval，也不定义自由文本 DSL。branch 条件必须保存为结构化 JSON：

```json
{
  "signal": "needsUserDecision",
  "op": "==",
  "value": true,
  "goto": "pause-user"
}
```

字段规则：

* `signal` 必须来自 `fromParseStep` 的 declared output signals：`ai-json` 使用 `ProfileCatalogSummary.signals[].id`，`regex` 使用该 parse step 的 `rules[].signal`。
* `op` 必须来自 selected parse output 的 allowed operators。`ai-json` 使用 `ProfileCatalogSummary.branchOperators`；`regex` V0 固定使用 `==`、`!=`、`is_null`。
* `value` 只能在需要值的 operator 中出现，并且必须符合 selected signal 的 `type`。V0 先只支持 `boolean-null`：`==` 和 `!=` 的 `value` 只能是 typed `true` 或 `false`；`is_null` 不带 `value`。branch compare 不做字符串到布尔的宽松转换。
* `goto` 必须是当前 template 内存在的 step id，并遵守 root `Identifier Contract`。
* `op=is_null` 不允许出现 `value` 字段，语义只匹配 selected signal 的 parser result 为显式 `null`。缺失字段是 parser schema validation error，不能进入 branch。
* 条件按数组顺序求值，第一个匹配的 condition 决定 next step；全部不匹配时使用 `else`。没有 `else` 时 runner 必须 pause/fail，不能默认继续。
* 非法 signal、非法 op、非法 value、未知 goto、不可达 graph、回跳边缺少 `loopGuard`、`loopGuard` 超出上限或其它循环风险，都必须在 `.003` schema/UI validation 或 `.005` runner preflight 阶段报错，不能运行时静默跳过。

示例：

```json
[
  { "signal": "needsUserDecision", "op": "==", "value": true, "goto": "pause-user" },
  { "signal": "hasAiFixable", "op": "==", "value": true, "goto": "send-fix" },
  { "signal": "onlyP3OrClean", "op": "==", "value": true, "goto": "final-review" },
  { "signal": "needsUserDecision", "op": "is_null", "goto": "pause-unknown" }
]
```

### SimpleLoop

V0 支持一个简单循环模型，不实现完整 `for_each` iterator。停止条件由普通 `branch` 表达，继续循环由回跳边表达。

任何 `next`、`goto`、`branch.conditions[].goto` 或 `branch.else` 指向当前 template 中更早 step 的边都叫回跳边。回跳边所在 step 必须声明：

```json
{
  "loopGuard": {
    "maxIterations": 5,
    "onLimit": "pause"
  }
}
```

规则：

* `maxIterations` 是正整数，V0 UI 应给出保守上限，建议最大 100。
* `onLimit` 只支持 `pause` 或 `fail`。达到上限后不能继续回跳。
* runner 从 event log 计算同一 step 的回跳次数；刷新或恢复后不能重置计数。
* 停止循环应通过 branch 跳到循环外 step，例如 `complete`、`pause`、`input_line` 或后续处理 step。
* 没有 `loopGuard` 的回跳边是 preflight fail。
* 完整 `for_each`、item 变量绑定、嵌套循环、`break` 和 `continue` 不属于 V0。

示例：

```json
{
  "id": "loop-review",
  "type": "goto",
  "goto": "ask-review",
  "loopGuard": { "maxIterations": 5, "onLimit": "pause" }
}
```

### UI

侧面板至少提供：

* template list、create、delete、duplicate、import、export。
* template editor 只编辑模板 `name` 和 `description` 等模板元信息，不设置 terminal alias，不设置顶层 capture source。
* editor / JSON tab 切换；JSON 不放在宏面板底部常驻。
* run controls 占位：start / pause / resume / stop 放在面板顶部；真正执行由 `.005` 实现。
* step add / remove / reorder by simple controls。
* terminal ref selection by current index、stable id or terminal tab alias；alias 来自终端 tab rename，后台实时维护 index/id/alias 映射。
* `capture-source` step 内选择 capture kind，默认 `terminal-buffer`，也允许 `agent-event`。
* parser kind selection: `ai-json` built-in profile or template-local `regex` rules。
* structured branch condition editor constrained by selected parse output `signals.id`、`signals.type` and branch operators。
* validation error list。

不要求拖拽。表单可以朴素，但必须能覆盖 V0 runner 所需 step 配置。

## 示例

```json
{
  "schemaVersion": 1,
  "id": "review-fix-loop",
  "name": "Review Fix Loop",
  "description": "review terminal output, route user decision, then loop",
  "configId": "local",
  "steps": [
    {
      "id": "ask-review",
      "type": "send_line",
      "terminal": { "kind": "alias", "value": "reviewer" },
      "text": "审查当前任务，只审查文档，按 P1/P2/P3 输出。",
      "next": "sleep-short"
    },
    {
      "id": "sleep-short",
      "type": "sleep",
      "durationMs": 1500,
      "next": "wait-review-output"
    },
    {
      "id": "wait-review-output",
      "type": "wait",
      "mode": "capture-ready-or-user",
      "captureStep": "capture-review",
      "timeoutMs": 600000,
      "onTimeout": "pause",
      "next": "capture-review"
    },
    {
      "id": "capture-review",
      "type": "capture-source",
      "capture": {
        "kind": "terminal-buffer",
        "terminal": { "kind": "alias", "value": "reviewer" },
        "mode": "scrollback-tail",
        "maxChars": 20000
      },
      "next": "parse-review"
    },
    {
      "id": "parse-review",
      "type": "parse",
      "captureStep": "capture-review",
      "parser": {
        "kind": "ai-json",
        "profileId": "review-routing-v1"
      },
      "next": "branch-review"
    },
    {
      "id": "branch-review",
      "type": "branch",
      "fromParseStep": "parse-review",
      "conditions": [
        { "signal": "needsUserDecision", "op": "==", "value": true, "goto": "ask-user-direction" },
        { "signal": "hasAiFixable", "op": "==", "value": true, "goto": "send-fix" },
        { "signal": "onlyP3OrClean", "op": "==", "value": true, "goto": "complete-review" }
      ],
      "else": "pause-unknown"
    },
    {
      "id": "ask-user-direction",
      "type": "input_line",
      "terminal": { "kind": "alias", "value": "main" },
      "prompt": "请输入要发送到 main terminal 的下一步指示",
      "allowEmpty": false,
      "next": "wait-main"
    },
    {
      "id": "send-fix",
      "type": "send_line",
      "terminal": { "kind": "alias", "value": "main" },
      "text": "根据 review 输出修复用户配置允许修复的问题。",
      "next": "wait-main"
    },
    {
      "id": "wait-main",
      "type": "wait",
      "mode": "terminal-quiet",
      "terminal": { "kind": "alias", "value": "main" },
      "quietMs": 1000,
      "maxMs": 600000,
      "onTimeout": "pause",
      "next": "loop-review"
    },
    {
      "id": "loop-review",
      "type": "goto",
      "goto": "ask-review",
      "loopGuard": { "maxIterations": 5, "onLimit": "pause" }
    },
    { "id": "complete-review", "type": "complete" },
    { "id": "pause-unknown", "type": "pause", "reason": "parser-result-unmatched" }
  ]
}
```

Regex parse variant can replace `parse-review` with:

```json
{
  "id": "parse-review",
  "type": "parse",
  "captureStep": "capture-review",
  "parser": {
    "kind": "regex",
    "rules": [
      { "signal": "hasAiFixable", "type": "boolean-null", "pattern": "AI 可直接修|ai directly fixable", "flags": "i", "onMatch": true, "onNoMatch": false }
    ]
  },
  "next": "branch-review"
}
```

## 测试

本任务验证 macro template 能被普通用户通过 UI 配置，而不是只能手写 JSON。

自动化测试至少覆盖：

* unit：template schema validation、ProfileCatalogSummary schema validation、parser config validation、TerminalRef validation、terminal tab alias resolution。
* unit：index ref 在当前 config 下解析为 terminalId；不同 config 下相同 index 不能交叉解析。
* unit：id ref 如果不属于当前 config，validation 或 run preflight 必须报错/暂停。
* unit：`send_line`、`sleep.durationMs`、`input_line`、structured `wait` modes、`capture-source`、`parse`、`branch`、`goto` 和 `loopGuard` schema validation。
* unit：structured BranchCondition 只能引用 selected parse output 的 `signals.id` 和 branchOperators，`value` 必须匹配 `signals.type`，且不允许字符串表达式。
* unit：regex parser rules validation，包括 flags allowlist 和 typed output signals。
* unit：import/export round trip，不丢 terminal refs、capture-source step、parser config 和 control-flow steps。
* component/e2e：创建模板、增加 step、选择 parser kind/profile 或 regex rules、保存、刷新后恢复。
* e2e：导入模板、复制模板、导出文件内容可再次导入。
* schema：macro template 不允许保存 Codex `session_id`。
* schema：`capture-source` step allows `terminal-buffer` and `agent-event`, with `terminal-buffer` as UI default。
* schema：V0 不允许用户自定义 AI parser prompt。

可选人工 smoke 建议覆盖：

* 用 UI 创建一个模板，包含 `send_line`、`sleep`、`input_line`、`branch`、带 `loopGuard` 的回跳 `goto` 和 regex parse step。
* 配置 terminal index、stable id、terminal tab alias 三种引用，并确认 alias 来自 tab rename，不在 macro panel 内另设映射。
* 复制、导出、导入、刷新页面，确认模板可恢复。
* 人工判断 UI 是否真的比手写 JSON 好用；如果关键路径仍必须手写 JSON，记录为 UX 问题。

Gate 规则：

* `just check`、`just test-unit`、`just test-e2e`、`just test-003` 必须通过。
* 人工 smoke 结果可以写入 review/verification；未记录不阻断 Close Gate。
* 人工发现 P2 schema/UX 问题时先修再进入 `.004/.005`。
