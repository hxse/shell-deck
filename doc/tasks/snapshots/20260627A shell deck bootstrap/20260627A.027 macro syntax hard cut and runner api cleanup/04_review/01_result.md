# Result

## 当前状态

`.027` 的 Macro syntax hard cut、exact TerminalRef、runner action request cleanup、editor/runtime 收口、Current Docs 同步与自动化验证均已完成。本 task 范围内无未解决 P1/P2/P3；既有 Vite bundle advisory 作为范围外 P3 保留，正式 Close Gate 通过。

当前设计真值已同步到 `doc/tasks/active_specs/macro_template_contract.md` 与 `doc/guides/001_quickstart.md`；本 task `02_spec` 保留本次 breaking contract、失败矩阵和 Legacy Kill 边界。Run-event replay contract 与历史 task snapshots 保持不变。

当前 jj change 为 `ryvovzuu`，description 是 `task 20260627A.027 macro syntax hard cut and runner api cleanup`。

## 实际修改

### Macro current schema

* Count range 唯一接受 `{ "kind": "count", "count": positiveInt }`；type、validator、runner 与 editor 不再把 missing kind 解释为 count。
* Count、forever、text-list range 的 required fields 必须是 own enumerable fields；text-list item 的 key/value 同样不能来自 prototype 或 non-enumerable property，避免 validator 通过后被 `JSON.stringify` 丢失。
* Macro TerminalRef 只接受 exact own-enumerable `{kind,value}`，index/id/alias 三种 current variant 保留；scalar、extra field、inherited/non-enumerable required field 全部失败。
* 删除 `FLOW_V2_FORBIDDEN_TYPES`、`LEGACY_FIELD_KEYS`、`rejectLegacyFields` 与旧 mode/parser 专用递归 scanner；退出的结构统一由 current allowlist / current union generic fail。
* Template import 不再为 missing id/createdAt 自动填充；save/import/read/list/duplicate/export/start 都复用 current validator 并 fail loudly，不迁移、不 normalize、不 rewrite。

### Runner、resume 与 editor

* Runner `executeFor` 使用 required discriminator 的 exhaustive switch；count/forever/text-list total 与 binding 分支没有 invalid default total。
* `MacroRunnerClient.resume()`、service resume 与 HTTP resume 都不再接收 `nextStepId`；resume position 继续只由 `.025/.026` 的 occurrence-aware server cursor 决定。
* Runtime 和 start request 删除 `mockCaptureText` / `mockCaptureReady` dead fields。
* Editor 直接读 `node.range.kind` / `node.range.count`，不再使用 missing-kind helper fallback；新建和 mode switch 都只生成 canonical range。
* Editor E2E 覆盖新建 count、forever→count 切换、JSON preview、save/reload，以及 invalid old import 不进入 selector/editor。

### Exact runner HTTP request

* 五个 action 使用 exact request union：start `{templateId}`、pause/resume/stop `{}`、input `{text}`。
* Unknown field 在 missing/type check 前失败；稳定错误是 `runner_request_missing_field:<action>:<field>`、`runner_request_invalid_field:<action>:<field>`、`runner_request_unknown_field:<action>:<field>`。
* Syntax parsing 在 `ensureConfig` 和 service dispatch 前完成并返回 422；runtime/service conflict 继续返回 409。
* Zero-byte empty body 等价 `{}`；pause/resume/stop 可 dispatch，start/input 返回 missing field。Whitespace-only body 是 malformed JSON，返回 invalid body 422。
* Rejected request 不创建 config/run，不消费 resume cursor，不追加 event，不改变 runner snapshot。

### Current Docs 与清理

* Active Macro spec 与 Quickstart 已写入唯一 count shape、exact own-enumerable TerminalRef、三种 current range 和 runner exact-body contract。
* Current Quickstart 不再推荐已经 superseded 的 `test-008-online` no-op；历史 recipe/script 保留为旧 task 证据，不进入 `.027` focused Gate。
* 删除全仓无消费者的 `.legacy-flow-panel`、`.legacy-step-actions`、`.legacy-badge` orphan CSS。
* 新增 `test:027` 与 `just test-027`。

## Post-review 修复

* **P2/L2（AI 直接修）**：ForRange、TerminalRef 和 text-list item 的 inherited/non-enumerable required fields 可在 in-process Store validator 中通过，但序列化后丢字段，可能写出旧 `{count}` 或 invalid `{}`。现统一要求 own enumerable，并补 schema/store no-write regressions。
* **P2/L2（AI 直接修）**：初版 whitespace-only body 被 `trim()` 当成 empty `{}`。现只对 zero-byte body做 empty normalization，并冻结 whitespace-only 422。
* **P2/L4（AI 直接修）**：初版 old-count disk fixture 同时含 empty for body，不能区分 discriminator 回归；runner start 也缺 extra TerminalRef 变体。现使用 single-fault old count，并分别证明两类 invalid file 不创建 run、不改变 snapshot。
* **P3/L4（AI 直接修）**：补齐五 action 的真实 no-body wire tests、editor mode switch/JSON preview、task failure matrix、single-fault 文档示例和真实 public route。
* **P3（AI 直接修）**：删除 orphan legacy CSS 与 Current Quickstart 中的 superseded online probe 推荐。

上述 findings 均已修复，没有需要用户拍板的项目。

## 验证结果

| 命令 | 结果 |
| --- | --- |
| `just check` | 通过：svelte-check 0 errors、0 warnings |
| `just test-027` | 通过：126 个 Bun tests、0 fail、636 expect；3 个 Chromium E2E 通过 |
| `just test-unit` | 通过：246 pass、0 fail、1170 expect |
| `git diff --check` | 通过 |
| `.orig/.rej/.tmp` 扫描 | 无残留文件 |

本机默认 Chromium 动态库搜索路径不完整；最终 E2E 使用当前 Nix system libraries 运行并通过。Vite build 仍输出 `>500 kB` chunk-size advisory，它是既有 bundle/code-splitting P3，不影响本任务 correctness。

## Legacy Kill List 结果

* Production/current docs 已无 optional count kind、missing-kind count branch、runner/editor count fallback、legacy type/field scanner、mock request/runtime fields、resume request `nextStepId`、import metadata fallback。
* 普通 source/fixture 全部使用 explicit count discriminator；旧 `{count}`、extra TerminalRef、mock fields 与 request `nextStepId` 只保留为明确 negative evidence。
* `{{text}}` 只在 invalid-template 或 literal-preservation tests/current spec 的“invalid”说明中出现，不存在 renderer alias。
* `data.nextStepId` 仅属于 server-computed run-event/cursor evidence；它不是 resume request 参数。
* Parser profile compatibility、terminal-manager scalar normalizer、run-event legacy replay 与历史 task snapshots 按冻结范围保留，不是 Macro template dual grammar。
* Current Docs 不推荐旧 count、旧 request 或 superseded online probe；无 `.orig/.rej/.tmp` patch artifact。

## 残余风险与范围外

* Server restart 仍不会 hydrate 并恢复 in-flight occurrence cursor；同一 runtime 内的 pause/resume 从准确 invocation 继续。
* Run-event legacy replay 与 `data.nextStepId` 是独立 event compatibility contract，不在本 task 删除。
* Macro JSON 的字段名仍是 `terminal`；本 task 不做字段重命名。
* 历史 `test:008:online` recipe/script 仍保留为旧 task 证据，但不再是 current guide 或 `.027` Gate 入口。
* Vite chunk-size advisory 作为非阻断 P3 保留。

## Close Gate 结论

Document Gate、Schema/Store/Runner/Editor Execution Gate、HTTP contract Gate、AI post-review、Legacy Kill List、Current Docs Gate 和正式自动化验证均已完成。本 task 范围内无未解决 P1/P2/P3；在上述明确范围外与既有 bundle advisory 下，`20260627A.027` Close Gate 通过。
