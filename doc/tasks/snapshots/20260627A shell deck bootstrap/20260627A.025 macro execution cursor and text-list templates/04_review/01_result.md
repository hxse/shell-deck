# Result

## 当前状态

`.025` 的实现、post-review 修复、Current Docs 同步和自动化验证均已完成。当前 change 未发现未解决的 P1/P2，正式 Close Gate 通过。

当前设计真值已同步到 `doc/tasks/active_specs/macro_template_contract.md`、`doc/tasks/active_specs/run_log_contract.md`、`doc/tasks/active_specs/capture_agent_event_contract.md` 和 `doc/guides/001_quickstart.md`；本 task `02_spec` 保留本次设计快照与验收边界。

## 实际修改

### Template language 与 validator

* 为 `for.range` 新增严格的 `{ "kind": "text-list", "items": string[] }`，保留 item 的顺序、重复、Unicode、换行和首尾空白。
* 新增显式 `ScopedTemplateText`、`TemplatableScalarText` 和 one-pass `{{text}}` renderer；普通 string/text 永远 literal。
* Validator 使用 lexical binding stack 校验 scope、nested shadow、strict token grammar 与 S1-S6 capability whitelist；不支持字段中的普通双花括号继续按原字段语义处理。

### Execution cursor、resume 与 artifact

* 新增 occurrence-aware execution cursor/context，sequence、if selection、loop iteration、parallel lane、wait/input/capture/notify sub-state 和 artifact environment 都按动态 invocation 记录。
* Cursor snapshot 可 JSON round-trip，并覆盖 input、wait、artifact、AgentEvent baseline/consumption/capture state 和 notification channel outcome；完成 iteration 时清理其 descendant continuation state。
* User pause/stop 在安全 operation boundary 确认：已经开始的 terminal/notification/input side effect 先完成并写入 event，再发布暂停或停止；resume 从 cursor 的下一 invocation 继续。
* `run_paused` / `run_resumed` 记录可读的 next step 与 execution path；parallel lane failure 使用对应 lane context，不读取共享可变 sibling context。
* Artifact lookup 优先当前 occurrence，再继承合法 outer predecessor；禁止读取 sibling lane、上一 iteration 的局部 producer 或未来 occurrence。

### Run log 与 AgentEvent

* 新增 `loop_iteration_started` / `loop_iteration_completed`，并给 step、send、wait、capture、parallel、pause/resume 等事件写入结构化 `executionPath`。
* Run-event schema 对任何存在的 `data.executionPath` 校验 segment；旧日志缺少该字段仍可 replay，不会伪造 durable cursor。
* AgentEvent baseline、已消费 identity、等待状态和 timeout budget 进入 occurrence cursor；同一 runtime pause/resume 不重复消费事件。

### Macro editor

* For Mode 新增 text-list item cards，支持 multiline、Add/Remove/Up/Down、reload 保真和 destructive mode-switch confirmation。
* 新增共享 `MessagePartsEditor` 与 `TemplatableScalarField`，统一 S1-S6 的默认关闭 checkbox、Insert token、scope source/shadow badge、无损 literal/template 切换和 out-of-scope 显式修复。
* Recursive editor 向 if/control/count/forever/parallel descendants 传递 lexical scope；nested text-list 显示最近 binding 并 shadow outer binding。

### 入口与 Current Docs

* 新增 `just test-025` / `test:025` focused Gate。
* 同步三个相关 active specs、task index 和 quickstart；quickstart 删除 legacy runnable macro 口径，补当前 Flow V2 action/control、最小 text-list/template 示例与限制。

## Post-review 修复

* **P1**：renderer 原先使用字符串 replacement，item 中以 `$` 开头的 replacement metacharacter 会被 JavaScript 特殊解释。已改为 callback replacement，并补 metacharacter regression。
* **P2**：将 input/artifact/AgentEvent/notify continuation 从 runtime 第二套状态收敛进 cursor 唯一真值，补完整 snapshot round-trip 与 iteration pruning。
* **P2**：补安全 pause boundary、concurrent input claim 和 pause/stop race；claimed input 使用 checkpoint drain 只推进已完成 frame，确保暂停事件指向真实后继 invocation。
* **P2**：冻结边界优先级：pause 遇到已完成的最后 action / `finish` 时允许自然完成，stop 则在已开始 side effect 的 outcome 与 `step_completed` 后优先写入 `run_stopped`。
* **P2**：AgentEvent direct/spool ingest 按 identity 幂等去重；consumer 使用 run-start high-water、sparse consumed holes 和连续前缀压缩，保留 `prompts=[A,B]` / `outputs=[B,A]` 的乱序完整 pair。
* **P2**：修正 parallel lane pause/failure context，以及 `run_paused` / `run_resumed` 的 next invocation evidence。
* **P2**：给所有可选 `executionPath`、`nextExecutionPath` 和 `nextStepId` 增加 schema validation，同时保留 legacy log compatibility。
* **P2**：补齐 S1-S6 root 无 scope、malformed inline issue、collapsed/narrow layout、移出再移回 scope，以及 unsupported schema matrix。

上述 finding 均在当前 change 修复；没有 L3/L4 或需要用户再次拍板的项目。

## 验证结果

| 命令 | 结果 |
| --- | --- |
| `just test-025` | 通过：130 个 Bun tests、0 fail、532 expect；2 个 Chromium E2E 通过 |
| `just check` | 通过：TypeScript check 通过；svelte-check 0 errors、0 warnings |
| `just test-unit` | 通过：239 pass、0 fail、965 expect |
| `git diff --check` | 通过 |
| `.orig/.rej` 扫描 | 无残留文件 |

第一次执行 `just test-025` 时，notification ID compatibility assertion 失败。实现随后收口为保留 `notif_<stepId>_` prefix 并使用 UUID suffix；按同一命令重跑后得到上表通过结果。

E2E 的 Vite build 仍输出 `>500 kB` chunk-size advisory。它不影响类型、运行语义或本任务 correctness，作为 P3 bundle/code-splitting 优化候选保留；本次结果不宣称 warning-free。

## Legacy Kill List 结果

* Runner 已删除 static `completedSteps` / `skipCompleted` 控制决策和 for 从第 0 轮重建的恢复路径。
* Runtime 不存在 `currentText` 共享可变 binding，也没有 text-list 专用 resume branch。
* Artifact 不再使用单层 `stepId -> artifact` 作为 loop/parallel 真值。
* Literal string/text 不做隐式 interpolation；template object 是唯一正式模板写法。
* 普通 send、notify 与 parallel-lane send 共用 message parts editor；S3/S5/S6 共用 scalar template field。
* Active specs、quickstart、旧 event assertion 和测试 helper 已按 occurrence-aware 模型同步；仓库无 `.orig/.rej` 残留。

## 残余风险与范围外

* Cursor snapshot 可序列化，但 server restart 后不会 hydrate 并恢复 in-flight interpreter；run 仍进入 `interrupted`。
* Terminal/notification side effect 成功而 event/checkpoint 尚未写入时的 process crash window 仍不保证 exactly-once。
* 不恢复 terminal 内第三方程序或 Codex session，也不实现 template snapshotting 或 transactional outbox。
* 不支持通用 expression、named/object binding、outer binding、`{{index}}`，也不把 template 扩展到 S1-S6 之外的字段。
* Vite chunk-size advisory 作为非阻断 P3 保留。

## Close Gate 结论

初版文档 Gate、Execution Gate、AI post-review、Legacy Kill List、Current Docs Gate 和正式自动化验证均已完成。当前无未解决 P1/P2；在上述明确的 P3 advisory 与范围外限制下，`20260627A.025` Close Gate 通过。
