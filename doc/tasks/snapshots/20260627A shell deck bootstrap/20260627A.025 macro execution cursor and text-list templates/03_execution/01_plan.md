# Execution Plan

## Gate 状态

初版文档 Gate 已由用户确认，相关源码与本计划也已完成 AI pre-review 并通过 Execution Gate。

五个执行阶段、AI post-review、Legacy Kill List、Current Docs 同步和正式 Close Gate 验证均已完成；实际结果与残余风险见 `04_review/01_result.md`。

## 阶段 1：基线与失败复现

* 用 focused runner tests 固定现有根因：for 从 iteration 0 重进、static `completedSteps` 混淆 occurrence、input/wait resume 重跑前置 action、loop artifact 只按 step id 覆盖。
* 扫描当前 runner、event kinds、derived state、schema recursion、MacroStepList 与 ParallelLaneTabs 的正式入口，形成文档到代码映射。
* 先证明 count/forever 的 no-duplicate resume 缺口，再改架构；禁止只新增 text-list happy-path test。

## 阶段 2：Execution cursor foundation

* 新增职责明确的 execution cursor/context 模块，承载 frame stack、InvocationRef、binding stack、artifact environment 和 safe suspension state；`macroRunnerService.ts` 保留服务编排，不继续堆叠隐式 cursor 状态。
* 重写 sequence、if、for、control-terminal、input/wait、agent-event capture 和 parallel 的 resume 主链，使 cursor 而非 static completed set 决定下一 invocation。
* 统一 count、forever、text-list loop frame；明确 break/continue/finish propagation。
* 让 duration、terminal-quiet、user-continue、input 和 agent-event capture 保存各自 suspension payload；agent-event baseline/consumption 按 InvocationRef 隔离；manual pause 只在安全 boundary 被确认。
* 为 notify channel 等 multi-effect action 保存 sub-invocation outcome，正常 resume 只重试失败/未完成效果，不重复已成功 delivery。
* 将 artifact map 改为 occurrence-aware execution context，并保证 lexical predecessor inheritance。
* 每完成一类 control，先运行相应 focused runner tests，再进入下一类。

## 阶段 3：Schema、renderer 与 run events

* 在 template types 和 strict validator 中加入 text-list、ScopedTemplateText、template message part 与 binding-stack context。
* 抽出纯 template renderer；只接受已经验证的 template 与 immutable binding，不读取可变全局状态。
* 增加 loop iteration events 和 structured executionPath data；让 pause/resume、step、terminal/capture/parallel events 具有可关联的动态 occurrence。
* 更新 replay/schema/derived node logs，使旧 event log 仍可读取，新日志能展示 iteration/lane path；不得把旧日志误判为 durable cursor。
* 为 `missing_template_binding` 和 preflight failure 补稳定错误测试，保证 delivery 前 fail-fast。

## 阶段 4：Macro editor

* 给 for range mode 增加 text-list item card editor，支持 multiline、Add/Remove/Up/Down 和 destructive mode-switch confirm。
* 从 recursive node editor 传递 template scope 与 JSON path；if/control body/parallel lane 继承，nested text-list 显示 shadow。
* 提取共享 message parts editor，消除 MacroStepList 与 ParallelLaneTabs 的重复实现；send/notify/parallel lane send 使用同一 template checkbox contract。
* 为 notify title、input prompt 和 user-continue prompt 提供共享 templatable scalar field。
* 用一份显式 capability whitelist 实现 `02_template_checkbox_matrix.md`，禁止 UI/validator 按任意 string 或 loopDepth 泛化；逐项覆盖支持与不支持名单。
* 扩展 LineNumberedTextarea 或共享输入组件，支持 Insert token 后恢复 selection/focus。
* 加入 field-local validation、scope badge、移出 scope 后的显式修复和 collapsed summary。

## 阶段 5：测试、文档与收口

* 新增 `just test-025`，聚合本任务 focused unit/integration/E2E；不得联系在线服务或真实 Telegram。
* 完成 schema、renderer、runner resume、artifact occurrence、run replay 和 editor 测试矩阵。
* 运行 `just test-025`、`just check`、`just test-unit` 和 `git diff --check`，检查 warning、skipped 与 summary，不只看 exit code。
* 做 AI post-review，逐条映射 task spec、代码、测试、event evidence 和 UI；P1/P2 必须在当前 change 修复。
* 收口阶段已同步 `doc/tasks/active_specs/macro_template_contract.md`、`doc/tasks/active_specs/run_log_contract.md`、`doc/tasks/active_specs/capture_agent_event_contract.md`、`doc/guides/001_quickstart.md`、task index 和 `04_review`。

## 预计文件影响

* Schema/types：`src/lib/macro/templateTypes.ts`、`src/lib/macro/flowV2Schema.ts` 及其 tests。
* Runner：`server/macroRunnerService.ts`，以及新增的 cursor/context/renderer 职责模块。
* Run log：`src/lib/runLog/runEventTypes.ts`、schema/replay/derived state/node logs 与 runner integration tests。
* Editor：`MacroStepList.svelte`、`ParallelLaneTabs.svelte`、`LineNumberedTextarea.svelte`，以及共享 message/template/range editor components 和样式。
* E2E/entrypoint：focused `.025` tests 与 `justfile`。
* Current docs：只在实现和验证收口后同步三个相关 active specs 与 quickstart。

## Legacy Kill List

* 删除 `executeFor` 每次从 zero-based index 0 重建、body 固定 `skipCompleted = false` 的恢复主链。
* 删除以 `Set<stepId>` 作为动态 execution cursor 的控制决策；允许保留 static summary，但不得参与 occurrence 跳转。
* 删除仅以 `stepId -> artifact` 表达 loop/parallel runtime artifact 的单层真值。
* 禁止新增 `runtime.currentText` 共享可变 binding 或 text-list 专用 resume branch。
* 禁止在既有 literal text/string 中隐式启用 `{{text}}`。
* 收敛 MacroStepList/ParallelLaneTabs 重复的 message part template 行为，避免两套 UI contract 漂移。
* 最终扫描旧错误文案、旧 event assertions、测试 helper 和 active specs，确保它们不再宣称 static step completion 足以恢复 loop。

## 停止边界与残余风险

当前任务在同一 runner 生命周期内证明正常 pause/wait/input continuation、text-list template 和 occurrence-aware artifact 后停止。Server restart durable cursor hydration、template snapshotting、transactional outbox/idempotent terminal writes、named/object bindings 与 dynamic expressions 只记录为后续候选，不因“还可以更完整”阻塞本任务。

正式 E2E 的 Vite build 仍有 `>500 kB` chunk-size advisory；它不影响本任务 correctness，按非阻断 P3 bundle/code-splitting 优化候选记录，不宣称 warning-free。
