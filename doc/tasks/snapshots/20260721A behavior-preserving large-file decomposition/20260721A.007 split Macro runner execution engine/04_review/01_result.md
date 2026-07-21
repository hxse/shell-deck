# Review Result

## 当前状态

`20260721A.007`实现与自审完成。`server/macroRunnerService.ts`由975行缩至587行，只保留Start/install、active registry、Pause/Resume/Stop/Destroy、checkpoint、runtime input、artifact/evidence commit、exactly-once terminalization和snapshot/delta publish。Flow V2/MacroDefinitionV5、terminal binding、Action语义、event taxonomy/order、artifact/Trace、AgentEvent wait-limit与cancellation contract均未改变。

## 实际代码映射

* `server/macroFlowExecutor.ts`：承接顺序body、If/Elif/Else、For、Parallel lane/merge、Break/Continue/Finish递归；只消费显式execution state和service callbacks，不访问active run map、Room manager或run store。
* `server/macroActionRuntime.ts`：承接Send、Input、Notify、Wait、Capture与Extract dispatch，以及冻结terminal binding上的input/read/quiet adapter；所有lifecycle event和artifact evidence仍回调service提交。
* `server/macroTextEvaluation.ts`：集中MessagePart、scoped For template、step artifact、terminal index、text matcher和Extract Text纯求值；错误code与求值顺序原样保留。
* `server/macroAgentCapture.ts`：集中递归capture target扫描、Room/terminal/launch match、late-event baseline、prompt/result配对、hook error、unbounded/timeout active-time wait与consumed event集合。
* `server/macroRunnerService.ts`：构造每个run唯一的action/flow context；继续拥有checkpoint、pause clock、input waiter、event append、artifact write、terminalization、structure lock与publish。
* `tests/unit/macroRunnerExecution007.test.ts`：新增3项、22个assertion，冻结pure evaluation、nested For/If/Parallel/Finish callback trace和Continue/Break lifecycle顺序。

## Ownership与行为边界复核

Flow executor不持有`MacroRunnerService`或`TerminalRoomManager`，只通过callbacks执行checkpoint、current node更新、Action、event/artifact commit和pause；Action/Agent模块没有terminalization入口。`completed`、`failed`和`stopped`仍只由service的`finish()`提交一次并释放structure lock。pending Input仍保留`submitted`/`cancelled`判别，cancelled分支抛出`run_stopped`且不发送terminal input。

每个原await/yield边界按原位置搬移：step前checkpoint、Telegram后checkpoint、duration 50ms slice、forever body后cooperative checkpoint、AgentEvent poll前checkpoint和abortable delay均未改变。Parallel仍以lane progress/output map原位重试，成功后清理并按lane顺序merge；失败不会建立第二个run状态机。

AgentEvent match仍固定server instance、Room generation、terminalId、launchId、Codex adapter和event kind。默认unbounded、显式timeout、Pause active-time扣除、hook error优先、prompt/result turn配对、late-event baseline与consumed id行为均由既有integration Gate验证。

## 自审结论

* P1：0。
* P2：0。
* P3：0。
* AI直接修：无实现缺陷；首轮sandbox内build因Vite等待esbuild service无进展而中止，宿主只读检查确认无遗留进程后在扩展权限下原命令通过，未修改代码或依赖。
* 需要用户拍板：无。

源码扫描确认没有第二份active registry、terminalization、terminal replay或Room snapshot cache；没有worker、parallel scheduler、schema alias、migration、legacy branch或新Action。Action terminal lookup只从冻结binding取得terminalId/launchId，不按live index重新绑定。service仍是durable event point-of-no-return和publish唯一owner。

## Gate结果

* `just check`：通过，TypeScript与Svelte均为0 error / 0 warning。
* `just build`：通过，216 modules transformed。
* `just test-unit`：168 unit与53 integration，0 fail；包含新增execution characterization及既有runner/store、fault injection、runtime sync和AgentEvent覆盖。
* runner定向integration：`macroRuntime034`、`roomRuntimeSync035`与`agentEventWaitLimit038`共22项，拆分前后均为22/22通过。
* `.034/.035/.037/.038` E2E：28项Chromium全部通过。
* offline complex Macro dogfood：`comprehensiveMacroUiBehaviorCurrent.spec.ts` 1项通过，覆盖真实PTY、Parallel/capture/extract、text-list、Input、Pause/Resume、Notify与Trace组合。
* `git diff --check`及duplicate lifecycle/active registry、compatibility、`.orig/.rej`扫描：通过。

## 文档同步

本任务只改变runner内部源码归属，不改变Macro、runner、terminal、evidence或AgentEvent contract，因此不改写`doc/tasks/active_specs/**`；本review与task index记录新的实现边界。
