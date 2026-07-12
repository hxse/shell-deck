# Execution Plan

## 当前状态

Document Gate 已由用户在 2026-07-12 的方案讨论与“新建 jj change 搞”指令中确认。AI pre-review 未发现 P1/P2 阻断项，Execution Gate 已通过。实现、Current Docs 同步、AI post-review、Legacy Kill 扫描与自动化验证均已完成；当前状态为 implementation-landed / automated close gate passed。

## Phase 1: Contract、Types And Validator

* 新增唯一 `TerminalEnding` enum 与 exhaustive sequence mapping。
* Send/Input type 将 `enter` 破坏性替换为 required `ending`。
* Send/Input exact-key allowlist与 validator只接受 own-enumerable四值 ending。
* 修正所有普通正向 fixture；旧 enter只保留 single-fault negative evidence。
* 补 store/HTTP/start fail-loudly覆盖，证明无持久化或 run side effect。

Gate：

* Schema/type tests覆盖四个正例与 missing/invalid/old/inherited/hidden反例。
* Store/HTTP/start旧写法失败且不创建、不覆盖、不启动。
* Production scan无 enter type/validator branch。

## Phase 2: Runner And Evidence

* Runner send/input/parallel send共享 exhaustive ending mapping。
* 删除固定 LF常量、boolean分支和 runtime fallback。
* `terminal_text_sent` current producer只写 `ending`，content/write artifacts继续保存精确前后 payload。
* Run Log demo与普通 replay fixture更新为 current evidence。
* 使用 recording backend参数化验证四个 sequence，并覆盖 input与parallel send。

Gate：

* Raw backend输入与 write artifact对 none/LF/CR/CRLF逐值一致。
* CR默认 real shell regression可提交命令。
* Event data无 current `enter` / `enterSequence`。

## Phase 3: Editor

* 普通 send/input和parallel lane send的checkbox替换为单一 select。
* 新建三个 surface均显式 `ending: "cr"`。
* Select切换更新唯一字段；save/reload/JSON preview保持值。
* 更新 E2E selectors、fixtures与 UI文案断言。

Gate：

* 三个 surface默认值、四值切换和持久化有 E2E evidence。
* 旧 checkbox/test id/文案不再存在。

## Phase 4: Current Docs And Focused Gate

* Macro active spec、run-log evidence说明和Quickstart切到 ending current contract。
* Task index追加 `.028`，不回写 `.022` 或其他历史 snapshot。
* 新增 `test:028` 与 `just test-028`，组合 schema/store/runner/input/parallel/editor/real PTY必要 suites。

Gate：

* `just check`。
* `just test-028`。
* `just test-unit`。
* `git diff --check`。
* 无本 task 引入的 warning、error、`.orig`、`.rej` 或临时 patch artifact；既有 Vite chunk-size advisory 单独记录为范围外 P3。

## Phase 5: Post-review And Close Gate

* 同时审阅代码和文档，逐项映射 `02_spec`、failure matrix与Legacy Kill List。
* 按 P1/P2/P3 + L1-L4报告 findings；范围内 L1/L2直接修复。
* 写 `04_review/01_result.md`，记录实际修改、验证结果、未覆盖与残余风险。
* 实现与自动 Gate通过后将 execution/task index状态更新为 implementation-landed / automated close gate passed。

## 文件影响

* Contract：`src/lib/macro/terminalEnding.ts`、`templateTypes.ts`、`flowV2Types.ts`、`flowV2Schema.ts`。
* Runtime/evidence：`server/macroRunnerService.ts`、`src/lib/components/RunLogView.svelte`。
* Editor：`MacroStepList.svelte`、`ParallelLaneTabs.svelte`、共享 `TerminalEndingField.svelte` 及必要 CSS。
* Tests：schema/template/editor、runner fake/recording/input/parallel、HTTP template、real PTY/E2E受影响 fixtures。
* Docs/entry：Macro/run-log active specs、Quickstart、task index、package scripts、justfile、本 task review。

## Legacy Kill 基线与最终扫描

基线扫描已确认 current production/docs/tests存在 `enter`、`enterSequence`、固定 `MACRO_ENTER_SEQUENCE = "\n"`、三个 checkbox与大量 positive fixture。

收尾扫描分层执行：

* Production/current docs：不得命中 Macro `enter` field、`enterSequence`、fixed LF submit、旧 checkbox/test id/文案。
* Tests：不得有旧写法 positive fixture；只允许明确 fail-loudly negative case和与 Macro无关的 physical Enter测试命名。
* Historical snapshots：不回写，不计入 current residue。
* User run-event files：不扫描、不迁移；generic replay不新增 compatibility branch。
