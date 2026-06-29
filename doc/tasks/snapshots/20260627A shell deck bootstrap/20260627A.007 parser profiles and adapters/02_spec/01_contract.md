# Contract

## 任务边界

本任务完成 parser adapters 和 parser invocation。输入是 `.006` 产生的 capture artifact，输出是 schema/normalize 后的 typed soft signals。V0 只支持两类 parser：`ai-json` 和 `regex`。bounded parallel lanes 留给 `.008`，V0 closeout 文档和最终 e2e 汇总留给 `.009`。

范围内：

* Parser adapter interface。
* `regex` parser adapter。
* mock parser。
* `ai-json` ParserProfile bundle。
* `codex exec` one-shot Spark probe。
* schema validation 和 normalize。
* branch declared signals validation。
* `ai-json` replicas disagreement pause。
* fixture eval。

范围外：

* 不实现 capture source。
* 不支持用户自定义 AI prompt。
* 不做系统级 audit。
* 不同步 active specs。
* 不新增第三种 parser kind。

## 任务规范

### Parser kinds

V0 parser 是用户显式选择的工具，不替用户选择输入来源或业务语义：

* `ai-json`：使用内置 ParserProfile，让一次性模型调用返回 JSON，再经过 schema/normalize 收口。产品默认不启用 mock，也不隐式消耗模型；未显式配置真实 adapter 时，parse step 必须 pause 为 `ai_json_adapter_not_configured`。
* `regex`：使用模板内结构化 regex rules 从 capture text 中匹配字符串并产出 typed signals，不调用模型。

### Regex parser

Regex parser 使用 ECMAScript RegExp，允许 flags `i`、`m`、`s`、`u`。V0 regex rule 至少支持 `boolean-null` signal：

```json
{
  "signal": "hasReadyText",
  "type": "boolean-null",
  "pattern": "ready|done|complete",
  "flags": "i",
  "onMatch": true,
  "onNoMatch": false
}
```

Regex parser 必须写 raw match artifact 和 normalized output artifact。Regex 不支持代码执行、不支持字符串表达式、不支持 JS eval。Regex rule 的最终 normalized value 必须是 typed `true`、`false` 或 `null`。

### AI JSON parser invocation

`ai-json` parser invocation 是无会话记忆的一次性调用。真实产品路径只能通过显式入口启用，例如 `just start-codex-ai` 或 `just dev-codex-ai`，底层传入 `--ai-json-parser codex-exec`。默认 `just start` 和 `just dev` 使用 `--ai-json-parser disabled`；`just start-mock-ai` 和 `just dev-mock-ai` 只用于本地开发、离线 demo 和测试，不是产品默认。每次真实 parse 都使用：

* selected parser profile prompt
* capture artifact
* selected profile JSON Schema
* selected profile checkSet
* run/step metadata

`codex exec` adapter 的推荐形态：

```bash
codex exec \
  --model gpt-5.3-codex-spark \
  --sandbox read-only \
  --skip-git-repo-check \
  --ephemeral \
  --output-schema <profile-schema.json> \
  --output-last-message <raw-output.json> \
  - < <parser-input.txt>
```

实现可以按实际 CLI 能力调整，但必须保持这些语义：不 resume、不复用会话、输入来自 artifact、输出受 schema 约束、raw output 和 normalized output 都写 artifact。

### ParserProfile bundle

V0 `ai-json` parser profile 是不可拆 bundle。它必须兼容 `.003 macro template workbench` 冻结的 `ProfileCatalogSummary` stub：相同 `profileId` 的 `signals.id`、`signals.type`、`parserKind` 和 `branchOperators` 不能静默变更；确需变更时必须提供 template migration/compat 说明：

```json
{
  "profileId": "review-routing-v1",
  "profileVersion": 1,
  "parserKind": "ai-json",
  "model": "gpt-5.3-codex-spark",
  "invocation": "codex-exec-one-shot",
  "promptId": "review-routing",
  "promptVersion": 1,
  "schemaId": "review-routing-result",
  "schemaVersion": 1,
  "checkSetId": "review-routing-checks-v1",
  "signals": [
    { "id": "hasAiFixable", "type": "boolean-null" },
    { "id": "needsUserDecision", "type": "boolean-null" },
    { "id": "onlyP3OrClean", "type": "boolean-null" }
  ],
  "branchOperators": ["==", "!=", "is_null"],
  "fixtures": ["review-routing-ai-fixable", "review-routing-user-decision"]
}
```

宏只能选择 `profileId`，不能修改 prompt。`.007` 负责把 `.003` summary stub 扩展为完整 bundle，不能把一个 profile 的 prompt 绑定到另一个 profile 的 checkSet，也不能在 branch 里引用 selected parse output 不声明的 signal。

V0 内置 `ai-json` profiles：

* `review-full-v1`
* `review-routing-v1`
* `claims-safety-v1`

### Parser result shape and normalization

布尔类字段 normalized value 使用 `true / false / null`：

* `true`：文本中有明确证据支持。
* `false`：文本中有明确证据反向支持。
* `null`：无法判断、证据不足或输出不完整。

涉及系统事实的字段必须是 `claims*`，表达“文本声称了什么”，例如 `claimsFileWritten`、`claimsNonReadonlyJj`。

每个 parser result 必须包含 selected parse output 声明的全部 signals，每个值必须 normalize 成 typed `true`、`false` 或显式 `null`。缺失字段是 schema validation error，不能进入 branch；声明外字段同样是 schema validation error。

原始 parser output 可以是 JSON boolean/null，也可以在 profile/rule 明确允许时是字符串 `"true"`、`"false"`、`"null"`。字符串到 typed value 的转换只能发生在 parser normalize 阶段；branch compare 阶段只比较 normalized typed value，不允许 `"true" == true`。

### Replicas

默认 `replicas=1`。`ai-json` 高风险 parser profile 可以配置 `replicas=2` 和 `agree_or_pause`。两个结果一致才继续；不一致时写 `parser_disagreement` event 并暂停，让用户选择采用 A、采用 B、重跑或编辑 profile。

Replicas 必须使用同一个 profile bundle。V0 不允许同一个 parse step 用两个不同 profile 的结果投票。Regex parser 不使用 replicas。

## 示例

```text
1. parse step 读取 artifacts/capture-0001.txt。
2. selected parser kind = regex 或 ai-json。
3. regex parser 直接产生 raw match artifact；ai-json adapter 生成 parser-input-0001.txt 并调用 codex exec one-shot。
4. parser raw output 写 artifact。
5. normalize 生成 typed signals，schema validation 通过。
6. parser_result 写入 event log。
7. branch 只能引用 selected parse output signals，且 BranchCondition.value 必须匹配对应 signal type。
```

## 测试

本任务验证 `regex` 和 `ai-json` 都能产出 typed signals。online model smoke 必须单独运行。

自动化测试至少覆盖：

* unit：parser adapter interface supports only `ai-json` and `regex`。
* unit：regex parser rule validation、flags validation、match/no-match/null、raw match artifact、normalized output artifact。
* unit：parser profile manifest validation。
* unit：完整 ParserProfile bundle 与 `.003` ProfileCatalogSummary stub 兼容。
* unit：parser result schema validation per profile/rule。
* unit：`true/false/null`、字符串 normalize 和 `claims*` 字段 fixture。
* unit：missing field / unknown field fail closed。
* unit：branch condition cannot reference signals outside selected parse output。
* unit：branch compare 不做 `"true" == true` 宽松比较。
* unit：replicas agree/disagree reducer。
* integration：terminal-buffer capture artifact + regex parser 驱动 branch。
* integration：terminal-buffer capture artifact + mock ai-json parser 驱动 branch。
* integration：mock AgentEvent capture artifact + mock parser 驱动 branch。
* integration：`codex exec` one-shot parser probe，验证 `--output-schema`、`--output-last-message`、无 resume、artifact 输入输出。
* integration：同一个 parser profile 的 fixtures eval。
* optional online smoke：配置真实 Codex/OpenAI auth 后运行一条 `ai-json` parser profile。

人工 smoke 建议覆盖，非 Close Gate 必需项：

* 人工配置并运行 regex parser，确认 pattern/flags/onMatch/onNoMatch 的 UI 语义清楚。
* 人工查看 parser raw output、normalized output 和 branch decision artifact。
* 人工试 `"true"` normalize、显式 `null`、parser failure pause，确认 UI 能解释原因。
* 具备 auth/network 时人工运行 online `ai-json` smoke；不可用时记录 blocked reason。

Gate 规则：

* `just check`、`just test-unit`、`just test-e2e`、`just test-007-offline` 必须通过。
* `just test-007-online` 在具备 Codex/OpenAI auth/network 时通过；若外部不可用，必须记录 blocked reason。
* 人工 smoke 结果如已执行应写入 review/verification；未执行时记录 not run reason，不阻断离线 Close Gate。
* regex parser 和 mock ai-json 必须支撑 `.008 bounded parallel lanes` offline e2e，不得依赖在线模型。
