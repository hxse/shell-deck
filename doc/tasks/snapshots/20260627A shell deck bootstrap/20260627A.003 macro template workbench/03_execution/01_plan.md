# Execution Plan

## 模块边界

本任务只做 macro template workbench，不实现 runner、event log、真实 capture 或 parser invocation。建议模块边界：

```text
src/lib/macro/templateTypes.ts
src/lib/macro/templateSchema.ts
src/lib/macro/profileCatalogSummary.ts
src/lib/macro/templateStore.ts
src/lib/macro/terminalRef.ts
src/lib/components/MacroPanel.svelte
src/lib/components/MacroTemplateEditor.svelte
tests/unit/macroTemplate.test.ts
tests/unit/profileCatalogSummary.test.ts
tests/e2e/macroTemplateWorkbench.spec.ts
```

`profileCatalogSummary.ts` 是 `.003` 冻结的最小 stub，只含 `profileId/name/description/signals/branchOperators`。`signals` 只冻结 V0 branch 所需的 `id` 和 `type`。完整 ParserProfile bundle、prompt、schema、fixtures 和 parser 调用留给 `.007`。

## 阶段

1. 定义 `TerminalRef`、`CaptureSourceRef`、`MacroTemplate`、`MacroStep`、`ProfileCatalogSummary` TypeScript 类型和 JSON Schema。
2. 固化 V0 内置 `ProfileCatalogSummary` stub：`review-routing-v1`、`review-full-v1`、`claims-safety-v1`。
3. 实现 template file store、import/export、duplicate、schema validation 和 config-scoped terminal ref validation。
4. 实现 structured BranchCondition validator：禁止字符串表达式，只能引用 selected parse output 的 `signals.id` 和 `branchOperators`，并按 `signals.type` 校验 typed `value`，同时校验 `goto` step id。
5. 实现 macro panel list/detail/editor：template CRUD、step add/remove/reorder、terminal ref selector、capture source selector、parser kind/profile/regex editor、input_line/sleep/control-flow forms、JSON preview、validation error list。
6. 补 unit/component/e2e 测试，并更新 quickstart 中 macro workbench 的当前可用范围。

## 验证命令

所有入口都走 `justfile`。底层可以由 recipe 调用 Bun/Playwright，但 Close Gate 只认稳定 just recipe：

```bash
just check
just test-unit
just test-e2e
just test-003
```

如果 `.003` 实现时这些 recipe 尚不存在，必须先在 `.002` 或本任务中补齐 recipe，再运行。

## Legacy Kill List

本任务不得引入：

* role / role_call / validator-call。
* Codex session 字段。
* parser prompt、schema、fixtures 或模型调用。
* background loop 或自动继续策略。
* UI 内部私有状态作为 template 真值；保存真值必须是 JSON template。

## 阶段停止线

进入 Close Gate 前必须满足：

* `.003` 可以在没有 `.007` 的情况下完成 UI/schema/branch 校验。
* `.003` 保存的 template 到 `.007` 后无需迁移即可继续使用。
* branch signal 校验使用 `ProfileCatalogSummary` stub，而不是 hard-coded UI 字符串。
* import/export round trip 不丢失 terminal refs、capture source 和 parser config。

## Close Gate

* `just check`、`just test-unit`、`just test-e2e`、`just test-003` 通过。
* 模板和 profile summary 能通过 UI 创建、编辑、刷新恢复、导入导出。
* 无需手写 JSON 也能构造 V0 runner 可识别的模板。
* branch condition 使用结构化 JSON，不能引用 selected parse output 之外的 signal，也不能保存字符串表达式。
* 模板中不存在 Codex session、prompt、full parser schema 或 fixture 字段。
* 可选人工 smoke 覆盖 UI 创建含 `send_line`、`sleep`、`input_line`、branch、regex parser 的模板，导入导出刷新恢复；结果可写入 `04_review/**`，但不阻断 Close Gate。
