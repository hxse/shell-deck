# Review Result

## 当前状态

`20260721A.004`实现与自审完成。`src/lib/components/MacroPanel.svelte`由1119行缩至195行，只保留既有chrome/editor/JSON/Trace composition、template search、view tab与notification profile展示；record/lease、JSON transaction、remote invalidation及runner/runtime input分别由同一panel实例内的session拥有。Macro schema、HTTP/Room contract、Prepare/Start规则、文案、DOM、focus和视觉行为均未改变。

## 实际代码映射

* `src/lib/macro/macroRecordSession.svelte.ts`：唯一拥有Macro list/selection、base/draft identity、dirty、content lease、CRUD、operation generation、published Create preservation、Library Save与beforeunload所需状态；每个operation token同时捕获record/revision、draft/JSON revision、controller epoch和edit lease id。
* `src/lib/macro/macroJsonEditSession.svelte.ts`：拥有JSON text/revision/error和pending candidate transaction；解析失败或409/500/lease loss只更新JSON error，server成功并完成authoritative安装前不关闭buffer或替换visual draft。
* `src/lib/macro/macroInvalidationQueue.ts`：拥有content sequence watermark、Macro pending buffer、own ack/higher revision/delete分类和原100/300/800ms bounded retry序列；该pure queue不写UI或record state。
* `src/lib/macro/macroRunnerSession.svelte.ts`：拥有Prepare、Room runner projection、Trace、Pause/Resume/Stop和runtime input coalescing；Start只消费record session给出的显式record snapshot，不修改selection/draft，也未新增polling或server state machine。
* `src/lib/components/MacroPanel.svelte`：按原markup绑定三个per-panel session，保留portable/runnable/runtime validation projection与局部view state；根节点和全部child component/prop/event inventory不变。
* `tests/unit/macroInvalidationQueue004.test.ts`：冻结mixed content watermark、own ack、higher revision、delete、consume和bounded retry/reset转换。

## 自审结论

* P1：0。
* P2：0。
* P3：0。
* AI直接修：初版runner Start曾复用完整按钮disabled条件；自审时恢复原handler的validation/runtime guard，避免把原本仅用于UI提示的dirty-lease条件变成新command语义。另把JSON candidate的pending marker收归JSON session，并补齐permission/pending早退时的原子清理。
* 需要用户拍板：无。

逐个await复核了operation generation/control epoch、definition revision、selection/record identity、lease acquisition/release和published result reconciliation。Create response在controller变化或remote Save/Delete后仍关联fresh record identity并保留submitted buffer；own ack先消费、higher revision/delete随后按server sequence重放；reconnect只覆盖clean readonly selection。runner shared truth仍只来自Workspace prop和显式HTTP response，runtime input的local generation/ack generation循环保持原顺序。

源码扫描确认`MacroPanel`不再持有record、lease、JSON、runner或operation可写state；三个rune session都由component factory逐实例创建，没有module singleton。依赖方向为`MacroPanel -> record/json/runner session`、`runner -> record operation interface/json`、`record -> json/invalidation queue`，无反向component import或Macro/Library generic session。父revision与当前markup逐行对比仅有Copy result从直接赋值改为同一record owner setter，DOM与child prop/event结构无变化；UI inventory仍为199 controls、无unidentified control、digest不变。

## Gate结果

* `just check`：通过，TypeScript与Svelte均为0 error / 0 warning。
* `just build`：通过，201 modules transformed。
* `just test-unit`：159 unit与53 integration，0 fail；包含新增3项invalidation queue characterization及Macro validation/HTTP/runner/lease覆盖。
* `just test-e2e`：完整50项Chromium E2E全部通过，覆盖Macro CRUD、visual/JSON/Copy/Prepare/run/input、双标签takeover、delayed Save/Create、remote Save/Delete、reconnect和beforeunload races。
* `just test-031b`：13项source/runtime inventory unit与13项current comprehensive Chromium UI journey全部通过；control count/digest及DOM/button inventory无漂移。
* `git diff --check`、内部owner/singleton/依赖、compatibility branch及`.orig/.rej`扫描：通过。

## 文档同步

本任务只改变browser内部源码归属，Macro、content lease、Room runner、Prepare与UI contract均未变化，因此不改写`doc/tasks/active_specs/**`；本review与task index记录新的实现边界。
