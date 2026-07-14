# 20260627A.034 Review Result

## 当前状态

实现与Implementation Gate通过。.034已原子接回production MacroDefinitionV3/MacroRecord CRUD、`.031`视觉工作台、显式draft-layout Prepare、version-bound Start、frozen terminal routing、live Pause/Resume及durable Trace evidence；没有提前实现`.035` Library。

2026-07-18 presentation follow-up：Macro顶栏入口接回已有switch/`aria-pressed`视觉；共享side-panel resize handle从被button padding撑宽的实色10px条收窄为6px透明hit area与2px状态线。

2026-07-18 selector follow-up：`Select macro`空值option改为显式取消当前selection；clean selection直接回到null，dirty selection复用discard确认且拒绝时恢复native value。该local action不删除record、不Prepare，也不影响active run。

## 实际代码映射

* `src/lib/macro/macroDefinitionTypes.ts`与`macroDefinitionValidation.ts`：唯一MacroDefinitionV3/Flow current schema、连续index/type layout、closed issue registry、object/text validation gateway及stable UTF-16 JSON position；旧V2/TerminalTarget/configId不进入runtime。
* `server/sharedContentStore.ts`、`server/httpServer.ts`与`src/lib/macro/macroRecordClient.ts`：user-global MacroRecord CRUD接入`.033` controller/content edit lease与expected revision；server生成record metadata，只保存validated definition。
* `src/lib/components/MacroPanel.svelte`及`src/lib/components/macro/**`：从`.031`精准恢复Macro/Editor/JSON/Trace composition、step/branch/parallel insertion/collapse、icon、line-number textarea和JSON edit lifecycle；wiring切为V3、lease、draft revision和pending inert。删除Duplicate/Import/Export，只保留clipboard Copy及New/Paste/Save。New/editing状态下selector与New保持可用，discard拒绝会恢复native select，New Discard清除draft；read-only selected record的Delete会在操作内部acquire/takeover lease、重读record并按revision删除，无需先点Edit。
* `src/lib/macro/macroTerminalChoices.ts`、`macroTerminalLayoutAuthoring.ts`与`MacroTerminalSelect.svelte`：selector只投影authoritative live `N · type`，集中派生selected/unconfirmed/empty/missing/incompatible状态；用户实际选择Action/Lane target时派生连续layout prefix，visual mutation后按实际引用裁掉unused tail，terminal event本身零definition mutation。独立Terminal layout section与`Room`来源后缀已删除。
* `MacroStepList.svelte`与`ParallelLaneTabs.svelte`：If/Elif/Extract始终完成插入；只使用exact insertion point之前、当前scope可见的compatible artifact作为默认source。无source时显示明确未选择占位并保留可编辑invalid draft，由统一validation阻止Save/Start，不猜测`capture_1`或future reference。
* `server/terminalRoomManager.ts`、`src/lib/protocol.ts`、`src/lib/macro/macroRuntimeBinding.ts`与`macroRunnerClient.ts`：authoritative terminal positions、只跟踪binding的terminalStructureRevision、readiness独立invalidation、structure queue/lock，以及唯一文字按钮触发的layout-snapshot Prepare。
* `server/macroRunnerService.ts`、`server/macroRunStore.ts`与`server/evidenceStore.ts`：saved revision与structure revision绑定的Start、完整definition和index/type/id/launch冻结、frozen-ID action routing、in-memory Pause/Resume/input，以及manifest → run_started → memory install边界和artifact_created evidence。
* `src/App.svelte`与`WorkspaceShell.svelte`：在`.032/.033` Room/controller/terminal chrome上恢复Macro panel和宽度/可见性，不重画terminal UI、不恢复Prompt/Library/config selector。
* Macro panel现以常驻组件实现纯布局显隐，隐藏/显示不再清空selection、draft、JSON buffer或lease；dirty Macro和打开的JSON Edit聚合到native `beforeunload`，不使用`localStorage`/`sessionStorage`恢复业务draft。
* `tests/unit/*034*`、`tests/integration/macroRuntime034.test.ts`与`tests/e2e/macroWorkbench034.spec.ts`：覆盖schema/gateway、editor commands、manifest/Trace、Prepare partial failure、immutable routing、Pause/Resume、input default、negative select、Destroy/controller interleaving和`.031`保留交互。`tests/ui-baseline/031B/**`继续保留不可变历史truth，并在本workspace新增175-control、零unidentified的`.034` source snapshot及两条current Chromium journey。

## Contract审计

* MacroDefinition只含schemaVersion 3、name、description、terminalLayout与body；record metadata和runtime terminal identity保持三层分离。Save不读取Room，Start才校验live binding/readiness。
* portable definition validity与Room runtime compatibility/readiness保持两层独立：schema/Flow/source/template/layout及Action引用等内部错误允许继续编辑但阻止Save/JSON commit/Start；missing terminal、live type mismatch或not-ready不阻止Save，只阻止Start并显示runtime诊断。`1 · shell`在空Room仍可Save，而layout仅有1、Action引用2时即使Room存在terminal 2也必须拒绝Save。
* terminal-bound selector在无live terminal、未确认target、失效index、type/capability不匹配时保持明确可见；layout只由用户实际选择的target派生并随引用删除回收，不创建terminal、不Prepare、不保存physical identity。
* Macro selector在New/editing/search-filter状态下仍保持可操作且固定显示current selection；Save与dirty Start保留Edit session lease，clean Done退出，New Create取得fresh record lease；dirty切换的accept/reject、lease release、selected edit Cancel与New Discard各自闭合。Delete直接可用但不绕过controller、edit lease或expected revision。
* 新Room保持null Macro selection。Settings、selection、New、Save、Start、terminal event均不会Prepare；唯一`Prepare terminals`按钮读取当前visual draft或当前JSON buffer，New/dirty/saved均可使用。
* Prepare不要求record identity，不Save，只keep/move/create/insert；stale revision零mutation，backend失败保留已完成步骤并返回authoritative snapshot，不staging/rollback。terminal/layout无产品级数量cap。
* dirty Start期间整个editor/selector inert，Create/Save response只有明确phase transition可进入Start；普通stale async response不能覆盖新draft或继续运行。
* 用户实测的“run completed后Macro仍全灰”不是structure lock泄漏：终态已释放terminal lock，真正原因是内部Save错误退出Edit session。修复后Save/dirty Start保留原editor lease，New Create先取得fresh record lease；completed/failed/stopped后仍可继续编辑，clean Done才显式转read-only。
* Start冻结完整definition、record revision、Room generation、structure revision和index/type/id/launch binding；Action执行时不重读MacroRecord或live index。active run structure lock覆盖Pause，Stop/终态释放，Home Destroy仍可关闭admission并终止run。
* Pause/Resume只恢复同一live run的当前位置。manifest/event/artifact只读持久化，server restart或Room generation变化后不恢复cursor/snapshot。
* hard-cut扫描未发现configId、schemaVersion 2、autoPrepareTerminals、TerminalTarget/alias或Duplicate/Import/Export业务入口。`Duplicate ... id blocked`仅是唯一ID校验提示；Macro JSON文本只有central gateway执行`JSON.parse`，MessagePartsEditor中的parse/stringify仅用于plain object clone，不解析Macro文本。

## UI touch审计

阶段零touch manifest中的Macro workbench组件与CSS均从`.031`的presentation/interaction语言恢复后做V3局部wiring。保留Macro/Editor/JSON/Trace层级、toolbar主次、step/branch/parallel block与collapse/insertion、icon/focus、textarea自动高度/临时resize/行号和JSON Edit/Cancel/Save流程。

有意变化只包括本contract要求的V3 hidden terminal layout authoring、controller/lease readonly、唯一`Prepare terminals`按钮、readiness状态、删除Duplicate/Import/Export、version-bound runner状态、terminal selector的空/未确认/失效/不兼容诊断placeholder，以及2026-07-16 usability回归确认的Macro New/Select/Discard/direct Delete状态闭合。Room Home、terminal tab/pane label、New shell实时cwd继承、single-controller topbar及Settings local controls未被Macro UI重构替换。

`.031B`演进Gate在本task发现并分类了四类差异：Macro panel恢复、Root已有Room时进入Home属于`.034/.032` contract内预期变化，测试只在本workspace更新；Home Refresh/Open/Destroy/empty New stable test id丢失，以及`upsertTerminal`重新让observer跟随controller新建terminal切换active tab，均为rebase造成的意外漂移，已恢复父task identity与initiator-only `terminal_created`选择语义，未放宽surviving behavior。原生confirm操作统一改为click与对应dialog成对等待，消除测试listener串台，不改变产品交互。

## Gate结果

* `just check`：通过，TypeScript与Svelte均0 error / 0 warning。
* `just build`：通过；177 modules，主JS 571.12 kB（gzip 160.25 kB）。保留既有单chunk大于500 kB warning，不阻断本task。
* `just test-unit`：通过；114 unit与28 integration，0 failure。
* `just test-032`：通过；114 unit、28 integration及10项Chromium Room/controller/Macro回归全部通过。
* `just test-033`：通过；同批114 unit、28 integration、10 browser，覆盖controller/content lease集成。
* `just test-034`：通过；同批114 unit、28 integration、10 browser，其中3项Macro workbench E2E覆盖显式Prepare、JSON lock、nested editor与dirty Start serialization。
* `git diff --check`与current-schema hard-cut扫描：通过。

2026-07-16 terminal selector收口后重新执行最新Gate：`just check`为0 error/0 warning；`just test-034`为115 unit、28 integration、11 browser，0 failure，其中新增Macro E2E覆盖空layout、missing index与无兼容slot；定向`macroWorkbench034.spec.ts`为4/4通过；`git diff --check`通过。

2026-07-16 Macro usability回归再次收口：`just check`为0 error/0 warning；`just build`通过，179 modules，主JS 572.57 kB（gzip 160.79 kB）；`just test-034`为115 unit、28 integration、12 browser，0 failure；定向`macroWorkbench034.spec.ts`为5/5通过。新增真实Chromium路径覆盖Edit→New、discard拒绝/接受与select DOM回滚、搜索固定current selection、saved edit Cancel、read-only direct Delete、New Discard，以及unsaved New Macro在Room terminal前后两种创建顺序下均初始化相同logical slot；`git diff --check`通过。

2026-07-16 多terminal authoring第一次根因修复移除了New-draft一次性seed，并通过当时Gate；但随后用户确认`Macro slots + undeclared Room terminals`仍是暴露后台来源的错误中间模型。本task最终以本review前文冻结的reference-driven hidden layout为准：selector只显示live `N · type`，Terminal layout section与`Room`后缀删除，layout只由Action/Lane实际target选择派生并随引用回收。该中间Gate仅保留为过程证据，不代表最终UI contract。

临时dogfood位于`/tmp/shell-deck-dogfood-20260716-7BwXhF`并在`.035`后继代码上通过：先以真实UI执行Send→3次New shell，断言Target tab列出1/2/3并选择3生成连续layout；随后保留Room terminal、丢弃local draft，加载复杂V3 Macro，运行真实PTY + Text + Parallel + capture/extract + text-list template + If + runtime Input + Notify。两个同URL Chromium tab完成observer同步与Take Control，关闭原tab后继续运行，第三个tab重连得到completed snapshot；最终`DOGFOOD_RESULT=PASS`，run event log以`run_completed`结束。

2026-07-16 reference-driven hidden layout中间收口：删除Visual Terminal layout section和Target中的`Room`后缀；New shell/text只刷新live选项，Action/Lane显式选择才派生连续prefix，删除或降低引用会裁掉unused tail。该次同时把无earlier artifact的If/Elif/Extract改为阻止插入并让测试接受此行为；此点后来确认违反`.031A/.031B`基线和用户明确要求，已由2026-07-18修正，不再代表最终contract。其余terminal selector Gate证据仍有效。

2026-07-16 `.031B`全面current dogfood收口：`just test-031b`通过7个inventory tests与2条Chromium journeys。Macro journey用纯UI从空Room创建4个真实Shell和1个Text，覆盖Macro CRUD/JSON、全部非Codex Flow/Parallel controls、模板语法、显式Prepare、Start/Pause/Resume/runtime Input、Notify、Trace、多terminal capture与live index/type漂移修复；workspace journey覆盖Room/Home、single-controller takeover、实时cwd、Text行号/clipboard、tab keyboard/drag/close和双tabserver同步。`just check`为0 error/0 warning；`just build`通过，180 modules，主JS 575.77 kB（gzip 161.49 kB）；`just test-034`为116 unit、28 integration、14 Chromium，0 failure；`git diff --check`通过。

2026-07-18 按`.031A + .031B`逐change重放时，Macro journey首次在Save后立即读取selector value并得到空字符串；失败快照随后已经显示fresh `tmpl_` record、revision 1与selected option，证明产品Save成功而测试早于异步commit读取。该项分类为`.034`测试同步缺陷，不是contract变化或产品漂移；本change改为先等待metadata退出`unsaved new macro`并轮询selector取得`tmpl_` identity，未放宽保存结果。修复后`just test-031b`重新通过7个inventory tests与2条Chromium journeys。

2026-07-18 用户实测再次暴露空scope点击`Add If`得到`Insertion failed`。复核发现原始`.031B`已明确断言无earlier artifact时If仍插入并进入invalid可编辑态，但`.034`错误地把“阻止插入”写入spec、实现和专项测试，control inventory又只验证click event而未验证mutation postcondition，导致错误变化被当作已归属行为。最终修正为If/Elif/root Extract/Parallel Extract始终插入；无source时显示`Select an earlier artifact`并由validation阻止Save/Start，有earlier source时仍默认最近compatible output。current `.031B` journey恢复空Root If与Elif的结构/placeholder/validation/removal断言，`.034`专项E2E增加四种无source插入及有source默认选择。

同日进一步冻结通用authoring原则：visual editor必须允许像写代码一样从中间开始、乱序补全。用户可先创建If consumer，再通过Add before或Move补齐earlier producer；临时invalid只影响validation、Save/JSON commit与Start，不影响继续Add/Move/Edit。执行依赖不得被实现成编辑顺序限制，也不得用自动producer、自动重排或猜测引用替代用户构造。

2026-07-20 conflict-resolution复审收口：在`.032/.033`底座重写后逐文件合并`.034`，没有整侧采用冲突版本。runner新增固定budget macrotask cooperative yield，tight forever不再饿死Stop/timer；terminal-quiet改用frozen launch的`outputActivityRevision`；Input submit先durable append再释放pending resolver，append fault保持可重试；run event append使用live monotonic cursor，消除逐event全量读log。Prepare的延迟HTTP snapshot按`roomRevision`拒绝回滚更晚WebSocket真值；Macro Update/Delete消费`.033` published commit `leaseOutcome`，record已durable而lease维护失败时仍返回authoritative结果并转read-only。

本次定向及完整`.034` Gate：`just check`为0 error/0 warning；132 unit与36 integration全部通过；`macroWorkbench034.spec.ts` 10/10通过，Room/controller剩余Chromium 9/9通过，共19项browser。新增确定性回归覆盖tight forever Stop deadline、满replay持续输出、Input append fault、250-event零重复log read、Macro update/delete lease-state fault和延迟Prepare snapshot。build仍报告既有single-chunk warning，留待最终stack统一拆包Gate，不把该warning记为本次冲突修复的功能失败。

## Warning与后继边界

* Vite production bundle现为571.12 kB，超过默认500 kB warning阈值；功能与性能Gate通过，code splitting留作独立优化，不在本task重画或拆散Macro UI。
* Playwright必须通过项目已有`scripts/runPlaywright.ts`补齐Nix Chromium runtime；直接调用`bun x playwright`会因缺少`libnspr4.so`在browser launch前失败，不是产品断言失败。
* `.035`必须直接复用本task的MacroDefinitionV3 text gateway与Copy-only/no-Duplicate语义；Library Load只创建MacroRecord，不能隐式Prepare。
* 产品仍是localhost默认、显式LAN且可信单用户模型；本task不新增账号认证或多人协作。
