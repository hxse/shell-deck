# Execution plan

## 阶段一：V6类型与唯一规则源

* 把`MacroDefinitionV5`及全部current consumer破坏性切换为V6。
* 删除Parallel Output/merge/`merged_text`类型与helper。
* 新建pure terminal usage policy，统一产出Shell owner、Text exclusive/shared、shared Send plan与stable validation evidence。
* 调整terminal layout authoring和artifact visibility，只从Action terminal收集layout，pane artifact不越过Parallel。

阶段验收：definition focused unit覆盖V6正反例；旧Parallel字段不能通过类型、validator或fixture。

## 阶段二：Visual authoring

* 重写Parallel policy/commands/controller的旧lane terminal与output职责。
* Parallel header增加Shared Text order；pane body从空Action list开始。
* Action editor复用root field contract，加入显式terminal selector和Notify。
* 由pure usage policy驱动selector disabled、状态badge与theme-native help。
* 删除Lane result、Collect、Output、Merge UI及其测试oracle。

阶段验收：focused component/unit和单workerE2E覆盖per-action target、Shell owner、Text shared状态与两种order。

## 阶段三：Runtime queue与failure coordination

* 新建invocation-local shared Text queue模块，保持per-target独立状态。
* Action runtime在最终payload形成后通过显式send port提交；普通Action立即写，shared Text由queue调度。
* Parallel executor改为可即时观察lane failure的coordinator，避免等待队列造成`Promise.all`死锁。
* Pause保留waiter并重试failed action；Fail/Stop/abort取消waiter；所有已提交Text保留。

阶段验收：queue unit覆盖ordinal/drain/cancel/retry，integration用真实Text terminal覆盖实时append、partial result和自然外部继续。

## 阶段四：Current truth与完整回归

* 更新Macro fixtures、current UI journeys、structure/control inventory及受V6影响的测试helper。
* 同步Macro/runner/architecture active specs与Quickstart；task index登记单向演进关系。
* 运行Legacy Kill List扫描、file-size Gate和全部串行验证。
* 完成侦探式post-review，修复范围内P1/P2并写`04_review`。

## Legacy Kill List

Close Gate前正式代码、current fixture、active spec与guide中不得保留：

* `MacroDefinitionV5`、`validateMacroDefinitionV5`及schemaVersion 5 current入口；
* `ParallelLaneOutputNode`、`ParallelOutputSource`、`ParallelCaptureSourceConfig`；
* lane-level terminal inheritance；
* `type:"output"`、`merge.sectioned_text`和`merged_text`；
* `Collect lane text`、`Lane result`、merge separator/include-empty controls；
* 把shared Text写入延迟到所有pane结束的staging path；
* compatibility alias、migration、V5 reader或silent default order。

历史task snapshot不回改；index关系负责说明V6取代旧Parallel contract。

## 主要文件边界

* `src/lib/macro/macroDefinitionTypes.ts`：V6 public type truth。
* `src/lib/macro/parallelTerminalUsage.ts`：pure usage/classification/plan truth。
* `src/lib/macro/macroControlValidation.ts`：消费policy并输出stable issues。
* `src/lib/components/macro/ParallelLaneTabs.svelte`及lane policy/commands/controller：authoring projection。
* `server/parallelSharedTextQueue.ts`：单次invocation queue。
* `server/macroFlowExecutor.ts`、`server/macroActionRuntime.ts`：pane lifecycle与send port。
* focused unit/integration/E2E：contract、queue、runtime与UI。

所有新增或本任务开始时未超限的手写code文件必须不超过400行；接近350行时优先按职责拆分，不用压缩单行规避Gate。

## 验证顺序

所有命令严格串行：

1. `just check`
2. `just build`
3. `just test-unit`
4. `just test-integration`
5. `just test-20260729a`
6. `just test-e2e`
7. `just diff-check`

focused调试也只通过已有或新增`just`入口执行，不与build/test并发。
