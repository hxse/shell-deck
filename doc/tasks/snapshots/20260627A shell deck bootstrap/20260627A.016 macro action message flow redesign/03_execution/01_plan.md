# Execution Plan

## Phase 0: Dependency and Layout Boundary Gate

* 确认 `20260627A.015 macro workbench component boundary stabilization` 已完成，并且 `.014` layout invariant e2e 仍通过。
* 读取 `.014` Macro Workbench Layout contract，把 Macro header、Template drawer/bar、Run status dock、Editor/JSON/Trace tabs、Trace placement 和 side panel sizing 视为不可变外壳。
* 本任务不得编辑 `.015` 拆出的 workbench chrome 组件，除非另开 layout task。
* 如果 Flow V2 editor 需要新控件，只能落在 node editor / action palette / flow palette 组件内部。

## Phase 1: Docs and Language Boundary

* 新建 `.016` task 文档。
* 不提前修改 active specs；只有 `.016` 代码实现落地并通过 gate 后，才同步 active specs。
* 在 task index 中标记 `.016` supersedes `.011/.012` 中关于 `sleep`、`parse`、`ai-json action` 的旧方向。
* 明确 current-schema-only 边界：模板 store 只接受当前合法 schema，不做旧格式兼容。

## Phase 2: Schema and Validator Slice

* 定义 Flow V2 `MessagePart` / `MessageSpec` 类型。
* 定义 `TextMatchCondition` 类型。
* 从 Flow V2 新建 schema 中移除 `sleep` / `parse` / `ai-json` / `send_artifact`。
* 从 wait schema 中移除 `capture-ready-or-user`。
* `capture-source.agent-event` 增加 `agent.kind` enum，初始只有 `codex`。
* Validator 拒绝 removed parser/sleep/send_artifact 等结构字段，但不扫描用户自由文本。
* Validator 校验 artifact source 必须来自 visible predecessor scope。

## Phase 3: GUI Slice

* 只修改 `.015` 拆分出的 node editor / action palette / flow palette 内部，不修改 Macro workbench chrome。
* Actions palette 删除 `sleep` 和 `parse`。
* `wait` editor 支持 duration / terminal-quiet / user-continue。
* `capture-source` editor 在 AgentEvent 模式显示 agent adapter dropdown，当前选项只有 Codex。
* `send_line` editor 提供 Add Text/Add Source 的 ordered parts UI，part 可上移/下移/删除；删除 raw JSON、prepend、append 固定槽位。
* Flow palette 移除 legacy flow nodes：`branch` / `goto` / `pause` / `stop` / `complete` / `fail`。
* Flow palette 新增 Py-like controls：`if` / `elif` / `else` / `for` / `break` / `continue` / `return`。
* `if` editor 提供 text match condition 表单：simple/regex、whole/lines、first/last/any/all。

## Phase 4: Runner / Compiler Slice

* Flow V2 interpreter/compiler 消费 `send_line.message.parts` 生成最终发送文本；`input_line.defaultSource` 只用于运行时输入框预填。
* `if.text_match` 直接读取 referenced artifact 并返回 bool。
* `wait` 不产出 artifact。
* `capture-source` 只产出 `captured_text` 给后续节点引用。
* Template runner 只消费当前合法 schema；旧格式或任何不合法模板必须在 read/list/import 阶段以 `invalid_macro_template` fail loudly，不得继续可编辑/可运行。

## Phase 5: Tests

Unit / validator：

* Flow V2 拒绝 `sleep`。
* Flow V2 拒绝 `parse` / `parser` / `ai-json` / `send_artifact` / `parallel_all` / `merge_parallel_results`。
* Flow V2 拒绝 `wait.mode = capture-ready-or-user`。
* `MessageSpec` 只支持 ordered literal text part 和 artifact source part；不支持 join、prepend、append、user_input。
* `parallel_send_capture` 复用普通 `send_line` 和 `capture-source` schema、validator 和 editor 组件，校验每个 item 的 terminal 唯一且 item/send/capture terminal 一致。
* `input_line` 不保存 message parts；它只保存 prompt、allowEmpty 和可选 defaultSource。
* `TextMatchCondition` 覆盖 whole/simple、whole/regex、lines.first、lines.last、lines.any、lines.all。
* artifact source 不能引用后续 step 或 sibling branch 产物。

E2E / GUI：

* Actions palette 不显示 `sleep` / `parse`。
* Flow palette 不显示 legacy `branch` / `goto` / `pause` / `stop` / `complete` / `fail`。
* Flow palette 显示 Py-like `if` / `elif` / `else` / `for` / `break` / `continue` / `return`。
* wait editor 显示 duration / terminal-quiet / user-continue，不显示 capture-ready-or-user。
* capture-source AgentEvent 显示 agent dropdown，选项包含 Codex。
* 新 Flow V2 不显示 `parallel_all` / `merge_parallel_results`；只显示受限 `parallel_send_capture`。
* send_line 可按顺序拼接任意 text part 与 capture/merge artifact。
* input_line 可用一个 capture/merge artifact 预填运行时输入框，用户修改后发送最终文本。
* if text match 能控制分支。
* parallel_send_capture GUI 支持 Add item -> select terminal -> reuse normal send_line editor and capture-source editor -> configure merge separator；不出现默认 `echo ready`。

## Phase 6: Review Gate

Close gate 需要：

* `just check`
* `just test-unit`
* `just test-e2e`
* 新增 `just test-016` 或等价 focused gate
* `git diff --check`
* `.014` layout invariant e2e：header/template/run/tabs/trace/tool-rail 不漂移

Manual smoke 延后到完整 Flow V2 interpreter/compiler 可运行后；本任务如果只是 schema/GUI slice，不强制人工 smoke。
