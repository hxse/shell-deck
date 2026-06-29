# Execution Plan

## 模块边界

本任务实现 parser profiles 和 parser adapters，不实现 capture source。建议模块边界：

```text
src/lib/parser/profileCatalogSummaryCompat.ts
src/lib/parser/parserProfileTypes.ts
src/lib/parser/parserProfileLoader.ts
src/lib/parser/parserResultSchema.ts
src/lib/parser/mockParserAdapter.ts
src/lib/parser/regexParserAdapter.ts
src/lib/parser/codexExecParserAdapter.ts
src/lib/parser/replicaReducer.ts
src/lib/parser/fixtureEval.ts
parser-profiles/review-routing-v1/profile.json
parser-profiles/review-routing-v1/prompt.md
parser-profiles/review-routing-v1/schema.json
parser-profiles/review-routing-v1/fixtures/*.json
parser-profiles/review-full-v1/...
parser-profiles/claims-safety-v1/...
tests/unit/parserProfile.test.ts
tests/unit/parserResultSchema.test.ts
tests/unit/replicaReducer.test.ts
tests/integration/parserFixtureEval.test.ts
tests/integration/codexExecParserProbe.test.ts
```

`.003` 已冻结最小 `ProfileCatalogSummary` stub。本任务只能补完整 bundle，不能静默改变已有 `profileId/signals/branchOperators`。

## 阶段

1. 定义完整 `ParserProfile` manifest/schema，并实现与 `.003` `ProfileCatalogSummary` 的兼容校验。
2. 实现 regex parser adapter：rule validation、ECMAScript flags allowlist、raw match artifact、normalized output artifact。
3. 为 `review-routing-v1`、`review-full-v1`、`claims-safety-v1` 补 `ai-json` prompt、output schema、checkSet、fixtures 和 profile manifest。
4. 实现 profile loader、version validation、prompt/schema/checkSet 不可拆 bundle validation。
5. 实现 mock parser adapter，支持 deterministic fixtures 和本地 runner tests。
6. 实现 parser result schema validation 和 normalize：`true/false/null`、字符串到 typed value 转换、`claims*`、declared signal 全量返回、missing field fail closed、unknown field fail closed。
7. 实现 `codex exec` one-shot `ai-json` parser adapter：stdin artifact 输入、`--output-schema`、`--output-last-message`、无 resume、raw/normalized output artifacts；非零退出如已有 raw output 也必须先落 artifact。
8. 实现 replicas reducer：`replicas=1` 默认；`replicas=2 + agree_or_pause` 不一致时写 event 并暂停；regex 不使用 replicas。
9. 建 fixture eval，记录每个 profile 的 pass/fail、样例覆盖和 regression 结果。
10. 接入 `.005` runner 的 parse/branch step，并以 `.006` capture artifacts 作为输入。产品默认 `ai-json` disabled；mock 只由 `start-mock-ai`/`dev-mock-ai` 和测试显式启用，真实模型只由 `start-codex-ai`/`dev-codex-ai` 或 online probe 显式启用。

## 验证命令

```bash
just check
just test-unit
just test-e2e
just test-007-offline
just test-007-online
```

`test-007-offline` 使用 regex parser、显式 mock `ai-json` parser 和 fixtures。`test-007-online` 才允许调用真实 Codex/OpenAI 模型；默认 `just test`、`just start` 和 `just dev` 不应隐式消耗模型额度，也不应静默使用 mock。

## Legacy Kill List

本任务不得引入：

* 用户自定义 prompt。
* 会话式 parser 或 `codex resume`。
* parser 输出作为系统审计真值。
* 自动越过 `null`、schema drift 或 replicas disagreement。
* profile prompt/schema/checkSet 混搭。

## 阶段停止线

进入 `.008 bounded parallel lanes` 前必须满足：

* 完整 `ai-json` profile bundle 与 `.003` summary stub 兼容，regex rules 使用同一 typed signal/branch contract。
* branch condition 只引用 selected parse output 的 `signals.id`，value 匹配 `signals.type`，且 branch compare 不做字符串宽松比较。
* parser input/output/raw/normalized artifacts 都可追溯到同一 run event log。
* regex parser 和 mock parser 可支撑 e2e，不依赖在线模型。
* online `codex exec` probe 有 pass 或明确 blocked reason，不影响 offline Close Gate。

## Close Gate

* `just check`、`just test-unit`、`just test-e2e`、`just test-007-offline` 通过。
* `just test-007-online` 在具备 Codex/OpenAI auth/network 时通过；若外部不可用，必须记录 blocked reason。
* 内置 profiles 均有 summary-compatible manifest、schema、typed signals、fixtures。
* regex parser 和 mock `ai-json` parser 可支撑本地测试。
* codex exec one-shot probe 有 go/no-go 结论。
* replicas disagreement 会 pause，不会自动越过用户。
* 人工 smoke 如已执行，覆盖 regex parser、mock/online `ai-json`、`"true"` normalize、显式 `null`、parser failure pause，并写入 `04_review/**`；未执行时记录 not run reason，不阻断离线 Close Gate。
* `git diff --check` 通过。
