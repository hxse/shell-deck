# Execution Plan

## 当前状态

Implementation landed；automated Close Gate passed。实现按 `02_spec` 收口，post-review 无未解决 P1/P2/P3，未引入迁移中间层。

## Phase 1: Current Types And Validator

* 将 count range discriminator 改为 required。
* 让 TerminalRef validator 使用 exact own-key check。
* 删除 production legacy type/field/mode kill lists，依靠 current allowlist fail loudly。
* 保留 session identity rejection和 literal user-text semantics。
* 把旧 count positive fixture 改成 negative contract test，修正全部普通 fixture。
* 补 Editor E2E：新建、切换、save/reload 的 count JSON 始终含显式 kind，invalid import 不进入 editor。

Gate：

* Focused schema/store tests证明 canonical 接受、旧 count 与 extra ref拒绝。
* TypeScript/Svelte check 不再允许普通代码构造 `range:{count}`。
* Editor JSON preview/persistence无 untagged count。

## Phase 2: Store, Runner And Editor

* 简化 import 已验证字段的不可达 fallback，只保留 current import metadata policy。
* Runner `executeFor` 按 required discriminator exhaustive 计算 total/item。
* 删除 runtime mock fields。
* Editor mode/count helper 不再把 missing/unknown kind解释为 count。
* 保持 count/forever/text-list、cursor 和 nested scope regression。

Gate：

* Store read/save/import/list/duplicate 的旧写法失败且无文件副作用。
* HTTP template import/PUT 返回 422 与准确 path；export 不得绕过 invalid disk file。
* Runner start 两类 invalid template 均不创建 run。
* Runner 三 range mode与 pause/resume现有 suites通过。
* Production scan 无 count fallback。

## Phase 3: Exact Runner Request API

* `StartMacroRunRequest` 只保留 templateId。
* `MacroRunnerClient.resume()` 与 service resume删除 nextStepId 参数。
* Runner HTTP action body增加 per-action exact-key parser。
* Syntax errors 在 dispatch 前返回 422；runtime/service conflicts继续 409。
* 补 HTTP integration tests覆盖 canonical、malformed/non-object、missing/wrong/unknown、空 templateId、空 input、resume/start退出字段。

Gate：

* 旧 request 不产生 run/cursor/terminal side effect。
* Client/service type 无旧参数。
* HTTP status 与 error prefix 符合 spec。
* Unknown field 在 missing required field 前返回，错误优先级稳定。

## Phase 4: Current Docs And Focused Gate

* Active macro spec删除 count compatibility口径和 removed-syntax历史清单，写唯一 current shape与 exact TerminalRef。
* Quickstart补 count canonical示例/说明和 runner request当前入口；不写迁移教程。
* Task index追加 `.027`，root child范围更新到 `.027`。
* 新增 `test:027` 与 `just test-027`，包含 schema/store/editor E2E/template HTTP/runner/API focused suites。

Gate：

* `just check`。
* `just test-027`。
* `just test-unit`。
* `git diff --check`。
* 无 warning、error、`.orig`、`.rej` 或临时 patch artifact。

## Phase 5: Post-review And Close Gate

* 同时审阅代码和文档，逐项映射 `02_spec`、failure matrix 与 Legacy Kill List。
* 按 P1/P2/P3 + L1-L4 输出 findings；范围内 L1/L2 直接修。
* 写 `04_review/01_result.md`，记录实际修改、验证证据、未覆盖和残余风险。
* 实现与自动 Gate 通过后将 task/index状态改为 implementation-landed / automated close gate passed。

## 文件影响

* Macro contract：`src/lib/macro/templateTypes.ts`、`flowV2Schema.ts`、`terminalRef.ts`、`templateStore.ts`。
* Execution/UI：`server/macroRunnerService.ts`、`src/lib/components/macro/MacroStepList.svelte`。
* Runner API：`src/lib/macro/runnerTypes.ts`、`macroRunnerClient.ts`、`server/httpServer.ts`。
* Tests：schema/template/editor/runner unit 与新的 runner HTTP integration。
* Docs/entry：active macro spec、quickstart、task index、package scripts、justfile、本 task review。

## Legacy Kill 扫描

基线和收尾扫描必须区分 production、current docs、tests、历史 snapshot：

* Production/current：搜索 `kind?: "count"`、`range.kind ?? "count"`、`range.kind === undefined`、`mockCaptureReady`、`mockCaptureText`、resume request `nextStepId`、legacy type/field scanner。
* Tests：不允许旧写法 positive fixture；允许明确的 fail-loudly negative fixture。
* Docs：active spec/guide不允许 compatibility推荐；历史 snapshot不回写。
* Event layer：`data.nextStepId` 和 old run-event replay明确排除，不能误删。
