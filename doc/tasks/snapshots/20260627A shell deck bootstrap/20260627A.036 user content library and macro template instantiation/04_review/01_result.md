# 20260627A.036 Review Result

## 当前状态

implementation-complete，Document/Code/Test Gate通过。

## 代码映射

* `src/lib/library/libraryTypes.ts`、`server/libraryStore.ts`：落地exact `LibraryItemV1`、三个kind、strict `lib_` identity、canonical `(kind,itemId)` path、private atomic file、optimistic revision、无永久cache与四字段stable search。Prompt/Note content不做语义解释。
* `server/httpServer.ts`、`src/lib/library/libraryClient.ts`：提供唯一Library CRUD与`POST /api/templates/from-library`；Create/Update/Delete/Load使用server-verified Room controller，saved Update/Delete同时消费content edit lease和expected revision。没有scope、move、Duplicate、clone、Import、Export或copy mutation route。
* `server/httpServer.ts`、`src/lib/protocol.ts`：Library复用`.035` generic `content_record_changed`和`.033` generic `content_edit_lease_changed`，resource key携带`itemKind/itemId`；不复制Library专用同步协议，不声称cross-process live push。
* `src/lib/components/LibraryPanel.svelte`：在既有Prompt side-panel presentation上接入Macro JSON/Prompt/Note tabs、Search、selector、New/Edit/Save/Cancel/Done/Copy/Remove/Refresh、saved read-only、pending inert、dirty与lease/remote notice。Macro JSON的`Load into Macro`位于上方item action toolbar，长正文之后只保留Validate。Save/Create与tab/selector/New共享包含kind、selected key/revision、draft object/revision、controller epoch和editLeaseId的完整operation snapshot；lease release整个await窗口立即pending，stale continuation不能清除后建draft或复活旧lease。Library invalidation另以observed sequence入队、operation settle后才replay和消费；自身ack不误报，更高revision/Delete会替换旧response的notice但保留submitted/dirty/lease-lost buffer，list refresh也不能提前清掉该selection。首次Create已publish但fresh-record lease未保留时另有独立preservation state，不能降级成普通clean read-only view；focus/background refresh不得覆盖它，只有显式New/Select/Edit/Discard/Refresh才解决该本地副本。preserved状态下按钮明确显示`Discard local copy`：先GET server latest，存在则安装最新revision，404则清空selection，其他错误保持原buffer与protection。follow-up为list/read加入独立单调generation和`applied | stale | retry`结果；reconnect/focus重新读取server truth，5xx不消费queued invalidation，protected buffer只更新notice。tab/filter和panel width/visibility只进入strict browser localStorage，selection/draft/content只留页面内存。
* `src/lib/components/workspace/WorkspaceShell.svelte`、`src/App.svelte`、`src/styles/workspace-panels.css`：只恢复与Macro同级的Library side panel、resize/reset/toggle和局部Library样式；Macro/Library组件保持常驻，toggle只改变可见性；两者dirty或preserved-local-copy状态聚合到唯一native `beforeunload`。transient reconnect不清聚合dirty，显式connection generation驱动两面板reconciliation；真正Room Destroy进入Home时才对称清理两者，避免phantom guard。terminal-first DOM、`.034/.035` Macro workspace、Home、Settings及全局视觉没有重排或重画。
* `src/lib/components/macro/LineNumberedTextarea.svelte`：仅增加通用readOnly输入，不复制textarea实现；Macro JSON Library复用既有自适应高度和1-based行号，Prompt/Note关闭行号。
* `src/lib/components/MacroPanel.svelte`、`src/lib/macro/macroRecordClient.ts`：Load重读saved revision并创建fresh MacroRecord；request/response两端逐项复核selection、base revision、draft revision、dirty、JSON edit、edit lease、pending operation与controller epoch。clean时自动选择，任一变化只创建不切换，两条路径都零Prepare。Macro toolbar的`Save to Library`则消费当前合法visual draft并经Library Create生成fresh Macro JSON item，不保存/切换Macro、不清dirty、不Prepare/Start。
* `tests/ui-baseline/031B/controlInventory.ts`与current journeys：历史`.031A/.032-.035`snapshot保持不动；`.036` current inventory为195个source controls、0个unidentified controls，新增`macro-save-to-library`后共22个Library-domain runtime controls均归属本task。

## Validation、storage 与cross-process证据

* Macro JSON browser Validate、server Save与Load都调用`.034`唯一`parseAndValidateMacroDefinitionJson`；`invalid_json`的offset/line/column与`invalid_macro_definition` issues由gateway原样返回。Library业务路径没有第二套Macro parser/issue registry。
* `tests/unit/libraryStore036.test.ts`覆盖exact schema、cross-kind同ID、normalization、0600 file、strict ID、四字段query与stable sort；两个Store instance下一次read直接看到文件真值。
* `tests/integration/libraryStoreProcess036.test.ts`与独立worker验证两个Bun process共享Library文件，竞争同一expected revision严格只有一个winner，loser为`content_revision_conflict`。
* `.033`既有cross-process lease Gate继续覆盖同一canonical transaction primitive；`tests/integration/libraryHttp036.test.ts`进一步验证Library controller/lease/revision CRUD、generic invalidation identity、single text gateway、fresh repeated Load、source immutability和零terminal mutation。

## 纯UI dogfood与漂移分类

`tests/e2e/libraryWorkbench036.spec.ts`从空Room开始，只通过可见UI完成switch toggle/resize/reset、三kind CRUD、Search、Copy success/failure、saved read-only、pending inert、Save后继续Edit与Done、dirty Cancel、Remove确认、Macro JSON行号与Validate、dirty Macro draft Save to Library、clean/dirty Load、same-Room observer拒绝、跨Room lease拒绝/接管及saved update刷新；不运行Codex，不直接写Library/Macro文件。它还以`route.fetch()`先完成server commit、延迟首次POST Create response，分别证明另一Room先Save更高revision和Delete时submitted buffer都不会被覆盖或清空；两条路径均验证preserved buffer触发`beforeunload`，点击`Discard local copy`后分别加载server r2或在404时清空，并解除guard。自身Save ack则等待operation settle与两次可观测list/replay读取，不使用timeout猜测ordering。它与两条`.031B` Room/Macro current journey一起进入`just test-031b`。

* 预期变化：`.035`没有production Library；`.036`只恢复current Library controls，不恢复旧Prompt scope、Directory/Global、Duplicate/Import/Export或旧schema。
* 非预期漂移一：Cancel对Svelte `$state` proxy直接`structuredClone`触发`DataCloneError`，界面保留了应丢弃的draft。修为字段级exact clone，并在释放lease前立即恢复last saved snapshot。
* 非预期漂移二：自身Save的generic invalidation和tab/search在途list响应可能晚于Save完成，覆盖`Saved`为item count。修为revision-aware自身事件过滤、后台静默list refresh、切tab取消旧debounce，并禁止list响应在dirty/editing/pending期间改写operation结果文案；Library dogfood连续三次通过。
* 非预期漂移三：tab/selector navigation曾在未占用operationPending时等待lease DELETE，紧随其后的New可先建立draft，再被旧continuation静默清除。修为统一serialized navigation operation；人为延迟DELETE的E2E同时覆盖selector→New、tab→New与Save pending→tab，逐项断言本地draft identity不被旧continuation覆盖。
* 非预期漂移四：Save response曾能在另一Room takeover event先清除lease后，用await前捕获的旧grant重新进入Edit；navigation还可能保留上一资源的leaseView，pending与controller同时变化时反馈优先级不稳定。修为Save/Create完整snapshot、published-but-read-only协调、离开资源时无条件清理lease presentation，以及所有serialized入口先返回operation_pending。随后进一步修复pending handler提前推进sequence导致更晚invalidation永久丢失：E2E以`route.fetch()`先完成server commit、延迟旧页面response，分别验证自身ack、另一Room takeover后Save更高revision与Delete，证明旧lease不复活、最终saved truth提示准确且本地buffer不丢。
* 非预期漂移五：首次Create response延迟、fresh-record lease已被另一Room抢先取得时，A安装r1后曾因`dirty/editing/editLease/leaseLost`均为false而被queued r2/Delete当成普通clean view覆盖。修为语义独立的published-Create buffer preservation state，并让auto-install、remote handler与list missing-selection共同尊重它；延迟POST Create的Save/Delete E2E均等待B mutation真实commit后才释放A response。
* 非预期漂移六：preservation state最初既未上报`beforeunload`，又让普通Cancel安装旧Create response snapshot；remote Delete时甚至形成phantom record。现在preserved local copy进入dirty聚合，且专用Discard只以server GET结果解决；读取失败不会清除唯一副本。

2026-07-20 conflict-resolution复审接入`.033` published commit contract：Library Update/Delete route改用published operation boundary并返回`leaseOutcome`；record durable后lease-state refresh/delete失败仍广播saved/deleted truth，Library client只在retained outcome继续Edit，否则清除旧grant、安装authoritative record并转read-only。既有navigation、pending Save replay、takeover、reconnect与published-Create preservation状态机保持不变。

本次验证：`just check`为0 error/0 warning；Library HTTP/Store 8/8先行通过，其中新增fault injection逐项验证update/delete的HTTP、GET/404与broadcast一致；`libraryWorkbench036.spec.ts` 11/11先行通过。随后`just test-036`完整通过136 unit、43 integration、43 Chromium，覆盖全部Library UI、lease/navigation/invalidation竞态及`.032–.035`回归。
* 测试自身的预期适配：Room reload产生新WebSocket client，按single-controller contract需要显式Take control；Macro selector是有dismiss layer的popover，测试必须真实开/关抽屉；折叠态用summary断言，不能假设内部表单常驻。

## Gate

* `just check`：通过，TypeScript与Svelte均为0 errors、0 warnings。
* `just build`：通过，183 modules；production JS 606.26 kB（gzip 169.57 kB），CSS 53.52 kB（gzip 10.53 kB）；保留继承的Vite单bundle大于500 kB warning。
* `just test-036`：通过；124 unit、37 integration、41 Playwright E2E。覆盖`.032-.036`完整回归、37 MB PTY/replay、Room controller、Macro runtime sync、Library navigation、pending Save/Create replay，以及Macro/Library reconnect、one-shot list 500 retry和Room Destroy清除聚合guard。
* `just test-031b`：通过；11个inventory assertions、13个Chromium current journeys，当前195 controls全部归属且无未识别控件；其中人为延迟lease DELETE、Save POST、已提交PUT response、首次Create POST response、强制WebSocket reconnect及Home guard resolution均稳定通过。
* Library UI dogfood `--repeat-each=3`：3/3通过，用于专门验证Save/list异步竞态。
* current-schema residue scan与`git diff --check`：通过。

## `.031A + .031B`逐change重放

以下数字冻结于2026-07-18的逐change历史重放边界，不代表后续加入pending Save/Create与reconnect竞态回归后的current Gate；后者以本页上方`11 + 13`为准。历史重放没有用最终`.036`绿灯替代中间revision证据，而是依次`jj edit`并在每个change独立运行当时的`just test-031b`：

* `.032`：3个inventory tests与1条Room/terminal Chromium journey通过；Room/Home与current terminal controls为预期新增，legacy fake/alias及阶段性缺少Macro/Prompt均有`.032` contract attribution，无非预期漂移。
* `.033`：5个inventory tests与1条single-controller journey通过；`Take control`及shared mutation controller-only为预期变化，observer读取、本地tab选择和Settings仍保留，无非预期漂移。
* `.034`：首次重放在Save后立即读取selector value时失败；失败快照已显示fresh `tmpl_` record、revision 1和selected option，根因为测试早于异步commit读取，不是产品Save失败。随后用户dogfood又发现空scope的`Add If`仍报`Insertion failed`：原始`.031B`其实已冻结“无source也插入”，但`.034`曾错误改写spec、guard和专项测试，而control inventory只验证click event，未验证mutation postcondition。两项修复均严格归属`.034`：Save等待fresh identity；If/Elif/root Extract/Parallel Extract无source时完成插入、显示未选择占位并由validation阻止Save/Start，有earlier source时默认最近compatible output。最终7个inventory tests、2条current journeys及`.034`专项7条E2E通过。
* `.035`：继承上述同步修复时只发生同段测试的机械rebase conflict，保留`.035`既有`toHaveValue(/^tmpl_/)`等待和全部runtime-sync语义；9个inventory tests与2条current journeys通过，额外双标签页runtime/Take Control/notification/input/Home/feedback E2E为3/3通过。
* `.036`：当时的边界为11个inventory tests和6条current journeys，覆盖195个current source controls；22个Library-domain controls由`.036`负责，`.032-.035`历史source snapshot保持不变。修复后的current Gate为11个inventory assertions与13条current journeys，见上方Gate段。

本次没有修改不可变`.031B`基线change；测试同步修复、If/Elif/Extract产品修复及错误contract更正都写入`.034`，后续change只通过jj rebase继承。最终没有未解决的产品级非预期漂移。

## Finding

* P1：0。
* P2：0。
* P3：production JS仍超过Vite默认500 kB warning；这是继承的非阻断bundle风险，本task没有借Library迁移重做全局chunk布局。

## Active spec同步

新增`doc/tasks/active_specs/library_contract.md`，并同步architecture、user data storage、Macro、quickstart、README与task index。Library现为current implementation truth，不再标记为后继任务。
