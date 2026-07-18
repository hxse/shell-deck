# 20260627A.037 Review Result

## 当前状态

implementation-complete，Document/Code/Test Gate通过。

## Schema与验证代码映射

* `src/lib/macro/macroDefinitionTypes.ts`破坏性切换到唯一`MacroDefinitionV4`。terminal target精确为`{kind:"terminal_index",index}`或`{kind:"unassigned"}`；required Action artifact source精确为`{kind:"step_artifact",stepId,artifact}`或`{kind:"unassigned"}`。`Input.defaultSource`仍是optional assigned-only，Parallel Output的`{kind:"none"}`仍表示明确无输出。
* `src/lib/macro/macroDefinitionValidation.ts`提供persistable `validateMacroDefinitionV4()`与runnable `validateRunnableMacroDefinitionV4()`。runnable入口先通过同一个persistable validator，再只增加stable `unassigned_terminal_reference`/`unassigned_artifact_reference` issues；assigned missing/forward/incompatible reference仍是persistable error。
* `parseAndValidateMacroDefinitionJson()`仍是Macro JSON和Library Macro JSON唯一文本入口。V3、primitive persisted `terminalIndex`、empty `stepId` placeholder、optional artifact message source和额外union字段均按exact current schema fail loudly，没有reader、migration、alias、normalizer或dual validator。
* `src/lib/macro/macroTerminalLayoutAuthoring.ts`只从assigned terminal reference形成连续layout；Unassigned不占slot，清除引用后可裁剪未再引用的tail。terminal create/delete/reorder事件不自动改写Macro draft。

## Visual/JSON与Library行为

* `MacroTerminalSelect.svelte`、`MacroStepList.svelte`、`ParallelLaneTabs.svelte`和`MessagePartsEditor.svelte`把Unassigned作为真实可选项。Send、Input、terminal-quiet Wait、Capture、Parallel lane，以及If/Elif、root/lane Extract、Send/Notify artifact part均显示局部amber warning；用户可主动从assigned清回Unassigned。
* 所有允许Unassigned的新terminal/artifact slot均无条件写exact Unassigned：已有live terminal或earlier compatible artifact只进入候选列表，不自动代选。If/Elif/Extract和新增message source仍能完整编辑，只有source为Unassigned，matcher/op/text/scope保持真实值。
* `MacroPanel.svelte`区分portable与runnable状态：Save只要求persistable valid；Start对unassigned显示精确数量和原因并保持不可运行。`MacroJsonView.svelte`在preview中显示同一runnable issue paths，JSON Save不补引用、不读取Room。
* `LibraryPanel.svelte`的Macro Validate接受persistable V4，并明确显示valid-but-not-runnable数量与paths。Save/Load原样保留Unassigned；Prompt/Note不解释该语法。既有Library CRUD、lease、Copy和Load identity没有重画或改义。

## Server与runtime边界

* `server/macroRunnerService.ts`在分配run id、取得structure lock、写manifest/event或安装live run之前执行runnable validation。`MacroNotRunnableError`携带deterministic issues，`server/httpServer.ts`以`macro_not_runnable`和HTTP 400原样返回。
* `MacroRecordStore.scan()`与`GET /api/templates`逐record隔离invalid envelope/JSON/V3 definition；valid V4 summaries始终返回，invalid id/error通过API与Macro warning显式报告。显式Read旧record仍返回`invalid_macro_record_definition`，没有legacy reader或migration。
* server integration验证Unassigned Start为零live run、零Trace/event、零terminal mutation。runner执行路径仍有defensive rejection，绝不把Unassigned转换成terminal 1、empty artifact、none、skip或continue。
* fully assigned V4继续使用Start时冻结的index/type→terminalId/launchId binding；Room/controller/runtime sync、Prepare显式触发及run evidence contract未改变。

## UI漂移审阅

* 本任务只修改引用selector、局部warning、validation状态和V4 JSON。Macro hierarchy、折叠/移动图标、panel尺寸、terminal/Home/Settings/Trace、Library布局及single-controller反馈保持前序视觉与交互。
* rebase审计保留`.034`的Macro/Library switch presentation和6px透明resize hit area，也保留`.036`的`Save to Library`。该按钮在V4使用persistable validator，因此未保存或dirty且含合法Unassigned的draft可进入Library，同时仍不改变Macro dirty/selection或运行状态。
* rebase审计同时保留`.035/.036`的pending content invalidation队列与published-Create submitted-buffer preservation state。V4 schema切换不把Create后未取得fresh-record lease的本地副本误当clean view；另一Room先Save更高revision或Delete时，只更新saved-list/remote notice，不覆盖Macro/Library submitted buffer。
* preserved Create buffer即使`dirty=false`也进入App唯一native `beforeunload` guard。Macro在显式New/Select/Edit latest后解除；Library显示`Discard local copy`，点击后重读server truth，record存在则安装latest revision，404则清除selection，其他失败保留唯一本地副本和unload protection。
* 后续交互复核把`.034`的`Select macro`冻结为显式null selection，并把`.036`的`Load into Macro`固定在Library上方item toolbar；两项均经V4专项E2E与完整current journey验证，未改变record、Prepare或active run语义。
* `.031B`历史source truth保持不可变；后继current inventory只把Macro schema说明切到V4。完整current Macro journey仍从UI创建复杂Flow、跨多个terminal捕获并运行，Library与Room journeys也继续通过。

## Gate

* `just check`：通过，TypeScript与Svelte均为0 errors、0 warnings。
* `just build`：通过，188 modules；稳定拆分为app 260.73 kB、xterm 329.30 kB、Svelte 38.00 kB与short-uuid 4.90 kB，所有JS chunk均低于Vite默认500 kB阈值，0 warning。
* core unit：149 pass，0 fail；覆盖V4 exact schema、白名单、persistable/runnable分层、issue顺序、layout authoring、Room projection/terminal revision单调合并、bounded/idempotent evidence、跨进程锁、run id collision retry以及production/test Shell history policy分离，并以静态oracle锁定两个公开leaf test entry都强制`HISTFILE=/dev/null`。
* integration：48 pass，0 fail；覆盖Macro/Library round-trip、Create commit authorization与published-operation边界、Load、Start错误优先级与零副作用、runner cancellation、cooperative forever yield、full replay tail quiet检测、durable Input提交、durable event已commit后的summary maintenance debt、fully assigned runtime、Room delta sync、record/lease post-publish failure与valid/invalid Macro record隔离。
* full Playwright E2E：47 pass；覆盖`.032-.037` Home/Room/controller/Macro/runtime sync/Library/Unassigned、live terminal query正常响应但Shell/Text切换的历史replay hydration零PTY input回灌、runner gap首次repair GET失败后无后续delta仍自动收敛、latest-value input coalescing、content lease loss、JSON失败buffer保留、outer artifact选择、serialized Library navigation、pending Save/Create期间自身ack与remote higher-revision/Delete replay、preserved Create buffer的native unload guard、reconnect期间dirty/preserved protection、单调list/read retry、committed Create identity reconciliation、延迟Prepare response不回滚WebSocket真值、Library Discard后latest/404 server-truth resolution、page-memory draft lifecycle及invalid-record可见诊断的全栈回归。
* `just test-031b`：11个inventory assertions与13条Chromium current journeys通过；复杂Macro、Room、Library用户行为及常驻panel隐藏语义未发生非预期漂移。竞态journeys人为延迟lease DELETE、Save POST、PUT response与首次Create POST response，并用`route.fetch()`先完成server commit后在另一Room Save更高revision或Delete再放行旧response；强制WebSocket reconnect与one-shot list 500进一步验证旧continuation既不覆盖draft、不复活lease、不吞掉saved-truth invalidation，也不解除唯一unload protection。
* history-isolation Gate：两个公开Bun leaf entry都直接设置`HISTFILE=/dev/null`，aggregate只组合leaf entry；本次完整integration与上条一致，为48 pass、0 fail。production `RealPtyBackend`没有test branch，仍依照调用方环境共享全局history。
* 新增JSON/Library path warning后定向E2E：2 pass；`git diff --check`与current-schema residue scan通过。
* jj重基冲突收口：`.033-.037`逐层保留后继实现与祖先安全修复；最终`.032-.037`均为普通change、无unresolved conflict。唯一预期测试演进是`.037`默认Unassigned后，Prepare ordering journey改为先通过UI显式选择terminal，再验证跨transport revision guard。

## Finding

* P1：0。
* P2：0。
* production bundle warning已清零：只建立稳定的first-party app/vendor chunk边界，不改变Macro/Library/terminal UI或运行contract。

## Active spec同步

`macro_template_contract.md`已更新为V4 current truth；Library、run log、user data storage、architecture、active-spec index与README同步引用新schema和persistable/runnable边界。
