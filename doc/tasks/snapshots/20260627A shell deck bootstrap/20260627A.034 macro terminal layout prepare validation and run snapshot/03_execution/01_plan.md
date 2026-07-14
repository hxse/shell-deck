# 20260627A.034 Execution Plan

## 阶段零：.031 UI reference提取与touch manifest

1. 从`.031`列出Macro panel、editor/JSON/Trace、run dock、selector、step/branch/parallel editor、message/scalar fields、line-number textarea及相关CSS/behavior tests，逐项标记“直接移植presentation”“替换V3 wiring”“contract明确删除/改变”。
2. 冻结实际UI touch manifest：每个拟修改/恢复/新增的Svelte/CSS文件必须写明V3、lease、Prepare、Start或validation理由；terminal chrome与.035 Library consumer排除在无理由修改外。
3. 优先恢复既有component structure与visual language，再在边界处替换types/client/store；强耦合处可拆presenter，但禁止把旧schema留作adapter或为了方便整面重写。
4. 迁移仍有效的interaction tests，覆盖DOM/control顺序、focus/keyboard、collapse/insertion、textarea/line number/resize、JSON edit lifecycle和readonly draft preservation；不建立截图像素Gate。

阶段验收：必须改变、允许局部调整、默认保护三类均有落点；未说明理由的UI/CSS diff为零，之后才进入production wiring。

### 阶段零实际 touch manifest（2026-07-15）

* `src/App.svelte`、`src/lib/components/workspace/WorkspaceShell.svelte`：只恢复`.031`已有Macro panel入口、可见性和宽度布置；保留`.032/.033`的Home、Room、controller与terminal chrome，不恢复Prompt/Library或config选择。
* `src/lib/components/MacroPanel.svelte`：恢复`.031`的Macro/Editor/JSON/Trace整体composition；数据生命周期替换为MacroDefinitionV3/MacroRecord revision、controller/content lease、显式Prepare和version-bound Start。
* `src/lib/components/macro/{MacroWorkbenchChrome,MacroTemplateSelector,MacroEditorShell,MacroJsonView,MacroRunDock,MacroTraceView,MacroStepList,ParallelLaneTabs,MessagePartsEditor,TemplatableScalarField,LineNumberedTextarea,MacroIconButton,NodeActionControls,TerminalEndingField,TerminalInputDeliveryField}.svelte`：直接移植既有presentation、focus/keyboard、collapse/insertion、icon、textarea/line-number/resize语言；删除Duplicate/Import/Export和physical terminal target wiring，把可运行terminal引用替换为`terminalIndex`，并增加唯一Prepare按钮。
* `src/lib/macro/{flowV2Types,flowV2EditorCommands,scopedTextTemplate,scopedTextTemplateEditor,terminalEnding,terminalInputDelivery}.ts`：保留仍属于V3 `body`的FlowV2语义与editor command；删除V2 record、configId、terminal ref/alias兼容分支。
* `src/lib/macro/{macroDefinitionTypes,macroDefinitionValidation,macroRecordClient,macroRunnerClient,runnerTypes}.ts`：新增V3唯一schema/text gateway、record CRUD、Prepare/Start与runner snapshot client边界。
* `src/lib/protocol.ts`、`src/lib/terminalRoomClient.ts`：增加authoritative `terminalStructureRevision`、runtime positions及structure-lock消息；不改变既有Room controller和terminal replay交互。
* `server/{terminalRoomManager,httpServer,macroRunnerService,macroRunStore}.ts`：增加structure revision/queue/lock、V3 CRUD、显式Prepare、version-bound Start、immutable binding/manifest/event log；保留`.032/.033`lifecycle/controller/content lease基础。
* `src/styles/{macro-workbench-base,macro-workbench-cleanup,macro-step-editor,run-log,workspace-panels}.css`与`src/styles.css`：恢复`.031`Macro专用视觉规则并仅做V3控件所需的局部增量；现有Room/terminal CSS不重排。
* `tests/{unit,integration,e2e}`与`package.json`、`justfile`：新增`.034`contract Gate并迁移`.031`仍有效的interaction断言；保留`.031B`历史truth，新增`.034` current source inventory、workspace journey与全UI complex Macro dogfood；历史`.032/.033`Gate继续执行。

明确排除：`.035` Library UI/存储、Prompt旧面板、configId/alias/title、Duplicate/Import/Export、V2 parser/store/API、Settings内Prepare开关。上述排除项不得以临时adapter形式恢复。

## 阶段一：current Macro schema、validator与CRUD

1. 建立MacroDefinitionV3和唯一`src/lib/macro/macroDefinitionValidation.ts` object/text gateway，冻结parseAndValidateMacroDefinitionJson的UTF-16 position、exact discriminated result、closed issue-code registry及stable path/message、排序、去重规则，把visual/JSON/CRUD/runner与.035 caller全部收敛到同一portable validator。
2. 将portable definition validity与Room runtime compatibility/readiness建模为两层独立状态：invalid definition保持可编辑但Save/JSON commit/Start均拒绝；合法definition即使Room mismatch/not-ready仍可Save，Start显示stable runtime诊断；Prepare只消费合法layout子集。
3. 把production Macro CRUD/editor/runner原子接到.032 MacroRecord primitive与.033 controller/content edit lease；saved record默认read-only。
4. 建立selected/base/draftRevision/dirty/editLeaseId/operationGeneration editor lifecycle，pending时整个editor inert且await后复核；Save保留Edit session lease，clean Done/Cancel/selection等才release；selector的`Select macro`空值option显式清回null selection，dirty accept/reject分别清空或回滚native selection；把dirty Start中的Save/Create response、fresh identity/revision和New record lease acquire建模为明确phase transition。
5. Macro panel visibility只切换布局可见性，组件常驻且不得丢失页面内存中的selection/draft/JSON/edit lease；dirty或JSON Edit用native `beforeunload`防止无提示刷新丢失，不把业务draft写入browser storage。
6. 删除Macro Duplicate/clone、Import/Export route/UI/client/store；冻结JSON Copy为clipboard-only、resolve后Copied/reject时clipboard_write_failed及New/browser Paste/Save创建路径。
7. 删除definition record metadata、config-scoped API、Macro V2和旧schema。

阶段验收：内部非法definition不能Save但draft可继续修；空Room、type mismatch或not-ready均可Save合法definition但不能Start；Action引用definition layout之外的index即使Room存在该terminal也不能Save；同一saved record跨Room/process只有一个editor；stale async response不能覆盖draft或继续Start；所有旧入口fail loudly。

## 阶段二：terminal layout、revision与显式Prepare

1. 把全部terminal-bound Action与Parallel lane切换为terminalIndex，删除TerminalTarget、physical ref、alias/rename/title editor。
2. 收敛server-authoritative ordered terminal collection，统一导出index/type/terminalId/launchId/readiness和terminalStructureRevision。
3. 冻结readiness映射；terminalStructureRevision只跟踪index/type/terminalId/launchId binding，readiness变化只广播并validation，建立唯一runtime binding validator与完整invalidation入口。
4. 删除visual Terminal layout section；全部Action/Lane selector只投影live `N · type`，用户选择时派生连续layout prefix，所有visual mutation后按实际terminal引用裁掉unused tail，terminal event本身零draft mutation。
5. 把visual authoring冻结为非线性draft editor：结构mutation不得以未闭合语义依赖为由拒绝；用户可先建If/Elif/Extract consumer，再用Add before/Move补齐producer。If/Elif/Extract始终完成插入；按exact insertion scope选择最近的earlier compatible artifact，无可用source时保留明确未选择占位并由validation阻止Save/Start。Parallel lane同时覆盖outer与lane-local顺序。
6. 从Settings/browser schema删除Prepare toggle；在Macro运行区Start左侧加入唯一`Prepare terminals`文字按钮，读取current visual/JSON draft的terminalLayout，New/dirty/saved均不要求落盘。
7. 建立共享layout sub-validator与JSON draft layout gateway；draft/JSON buffer/selector/button和Prepare operation串行锁定。Prepare exact request只携带layout snapshot与terminalStructureRevision，只keep/move/create/insert且不处理readiness；不设terminal数量cap，backend/OS中途失败立即报错并返回latest authoritative partial snapshot，不staging、不rollback。

阶段验收：只有按钮click触发Prepare；selection/Library Load/New/Save/reload/terminal event/Start均零调用；Target无`Room`后缀且New shell/text不改draft；Action target选择/删除正确派生和回收layout；从空body先插入If、再Add before Capture并选择source可以从invalid draft闭合为valid，未闭合时Start禁用；If/Elif/Extract有source时只默认earlier compatible artifact且不生成future引用；New/dirty/JSON layout可用且last-valid fallback不存在；double click/selection不重叠；stale terminal revision零Room mutation；starting/exited/failed只报错不治疗。

## 阶段三：version-bound Start与immutable run

1. Prepare/Start先取得.032 generation-bound lifecycle ticket；Prepare绑定request layout snapshot与expectedTerminalStructureRevision，Start exact request绑定expectedMacroRevision和expectedTerminalStructureRevision，并在.033 controller、Room queue与exclusive structure lock内复核。
2. 冻结完整canonical MacroDefinitionV3、hash、record revision、Room generation、structure revision和index/type/id/launch mapping。
3. 将全部Action routing改为frozen terminalId，禁止Action-time live index或step-time MacroRecord lookup。
4. 按exact RunManifestV1、canonical JSON/SHA-256和atomic publish实现manifest；event evidence使用100-event segments、永久summary与最多1000条durable tail，并冻结manifest publish、run_started append、in-memory install三段durable bootstrap及Destroy forced-interleaving边界。live run缓存provenance/next sequence/bounded window，normal append零segment回读；ambiguous publish按stable sequence/intent幂等收口，partial final line可恢复。
5. 冻结Starting/Running/Paused/Stopping的terminal structure UI/server endpoint；按.032保留Room Home generation-bound lifecycle Destroy例外，不获取目标Room controller。
6. 为runner loop加入固定budget cooperative macrotask yield；terminal-quiet消费.032的frozen-launch outputActivityRevision；Input submit及Pause/Resume/Stop/finish按durable append边界收口，append fault不得丢pending resolver或制造双终态。
7. Prepare HTTP snapshot按.032 roomRevision monotonic merge，不能覆盖更晚WebSocket真值；Macro Update/Delete逐字消费.033 published commit的leaseOutcome并在lost时转read-only。

阶段验收：后续Macro revision不改变active run；mismatch/not-ready/stale revision零run；restart/Destroy后run_not_active且Trace仍可读。

## 阶段四：测试、文档与hard cut

1. 补validator object/text exact result、shared layout sub-validator/JSON draft layout gateway、stable JSON position/closed issue registry与caller、editor lease/revision race、dirty Save/Create→Start phase transition、Save portable-only、Prepare draft/selector lock、terminalStructureRevision/readiness分离与unbounded layout unit tests。
2. 补layout-snapshot-bound Prepare、version-bound Start、backend partial failure authoritative snapshot、immutable run manifest durable bootstrap、frozen routing与Home lifecycle Destroy/async forced-interleaving integration tests。
3. 补new Room null selection、Copy/Paste、无Duplicate/Import/Export、跨Room edit lease和observer UI browser E2E；在`.034`工作区演进`.031B` current journey，从空Room经可见控件创建真实Shell/Text与复杂Macro，覆盖全部非Codex UI、显式Prepare、运行、Pause/Resume/Input、Trace和terminal漂移修复。
4. 更新active specs、guide、README、AGENTS与just test-034；执行受影响历史Gate和残留扫描。
5. 对照阶段零touch manifest审计实际UI diff，逐项记录有意偏离与contract理由；删除为了重写方便产生的无关布局、视觉或交互变化。

## 实施约束

* current-schema-only hard cut，不添加V2 migration、alias、dual parser或converter。
* MacroDefinitionV3、MacroRecord与runtime terminal identity必须分层。
* Save只做portable validation，不读取Room；Start只运行明确saved revision并验证Room。
* Macro server API仅CRUD；Copy只写clipboard，Duplicate/clone/Import/Export/copy-and-create必须删除。
* Settings、selection、Library Load、Save、Start或terminal event不得Prepare；不新增Use/Activate、Start-and-prepare或第二个Prepare入口。
* Prepare与Start共享Room structure queue，但Start绝不调用Prepare。
* Prepare不等待starting，不restart/替换exited或failed terminal。
* 不设置Room terminal/terminalLayout数量上限；transport byte limit与backend resource failure不能伪装为terminal capacity contract。
* draftRevision/selector lock、controller、operation generation、Start record revision与terminalStructureRevision不能互相替代；Prepare不得要求record revision。
* terminal index只从live ordered collection导出；terminalId仅在当前Room generation内稳定。
* cwd既不进入Macro，也不进入readiness；Prepare-created Shell使用$HOME。
* Prepare/Start完整持有.032 lifecycle ticket；active run structure lock不阻止Room Home generation-bound Destroy，该lifecycle操作先关闭admission、abort/drain ticket且不要求目标controller。
* bounded event tail与permanent summary是run lifecycle evidence；RunManifest永远不是启动证明、routing或Resume输入。旧event按固定retention永久删除，artifact保留。
* `.031`只作为presentation/interaction参考，不作为V2 schema来源；默认移植和局部改造，不从空白发明陌生Macro UI。contract未点名的既有精调设计默认保护，但不做截图或pixel lock。

## 验证顺序

1. Macro schema/gateway object/text exact result、JSON position/issue registry、CRUD/edit lease、dirty Start phase transition、Copy-only与legacy kill unit tests。
2. terminalStructureRevision/readiness separation、unbounded layout、显式draft-layout Prepare/button lock/backend partial failure/Start version binding protocol tests。
3. immutable definition/frozen ID routing、Pause/Resume、RunManifest durable fault boundary与Home Destroy forced-interleaving integration tests；补tight forever调度、满replay quiet、Input append fault、ambiguous append/partial line、1000-event retention、large event cursor、published commit lease degradation与equal-revision延迟Prepare snapshot回归。
4. 无Settings toggle、唯一Prepare按钮、selection零mutation、error/observer UI和跨Room content lease browser E2E；同时覆盖阶段零保留的DOM/control顺序、keyboard/focus、collapse/insertion、textarea/JSON lifecycle与draft preservation，不做截图比较。
5. just check、just build、just test-unit、just test-032、just test-033、just test-034与受影响task Gate。
6. legacy rg扫描、touch manifest外UI/CSS diff审计与git diff --check。
