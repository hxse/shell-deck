# Execution Plan

## 当前状态

Document Gate与Execution Gate已通过；Auto implementation、Current Docs、Legacy Kill、真实Shell/Text/Codex Gate及三路post-review均已完成。本task范围内P1/P2/P3清零，Close Gate通过。当前jj change为`luknsqyr`，description是`task 20260627A.029 terminal input delivery modes`；没有创建新task或执行`jj new`。

## Phase 1: Contract、Types And Validator

* 将唯一`TerminalInputDelivery`扩为`auto | direct | bracketed-paste`，新增只含两个actual mode的`ResolvedTerminalInputDelivery`与exhaustive target-capability resolver。
* Send/Input required `delivery`；parallel send继续复用 SendNode。
* Send/Input allowlist与validator只接受own-enumerable三值delivery；missing仍失败，不把缺字段解释为Auto。
* 保留已有explicit Direct/Bracketed paste positive fixtures，不批量rewrite；新增Auto专项与新建默认evidence，missing delivery只保留single-fault negative evidence。
* Store/HTTP/start补 fail-loudly覆盖。

Gate：

* Type/schema tests覆盖三个正例与missing/invalid/old alias/inherited/hidden反例；resolver覆盖Auto × Shell/Text及manual override。
* Invalid input不创建、不覆盖、不启动。
* Production无 optional/default/migration branch。

## Phase 2: Shared Wire Builder And Evidence

* 保持唯一shared terminal input payload builder只接受resolved mode；在shared write path按current target capability解析requested delivery。
* Resolved Direct/Bracketed paste × 四种ending逐值exact mapping；Auto Shell/Text命中对应actual wire。
* End marker collision在 manager/backend write前拒绝。
* Send/input/parallel复用同一 builder与 logical dispatch。
* Current`terminal_text_sent`同时写requested`delivery`与actual`resolvedDelivery`；content/write artifacts分别保存正文与完整wire。
* 普通send collision沿现有step error暂停；input暂停后resume重新等待新输入；parallel继续由onLaneFail决定failed/paused。

Gate：

* Recording backend exact byte oracle覆盖8个resolved组合、Auto Shell/Text、manual override与unknown capability fail-loudly。
* Collision覆盖static/跨parts/template/artifact/input与三种resume路径，zero terminal write/current success event。
* 无 delay、second write、Codex branch或wrapper config injection。

## Phase 3: Editor

* 扩展现有共享`TerminalInputDeliveryField`为三项与focusable Auto tooltip。
* 普通send/input和parallel lane send都显示相同三项select与共享Auto tooltip。
* 新建节点显式auto；Ending继续默认cr且不增加Ending Auto。
* Target切换保持requested delivery；preview/save/reload/duplicate/export覆盖三种delivery与四种ending，resolved值不写回template。

Gate：

* 三个surface的Auto默认、三项顺序、精确tooltip、target切换和manual persistence有E2E evidence。
* 无 `Enter / CR` 或 target-specific UI。

## Phase 4: Real Terminal And Codex Regression

* Real Bash/readline验证Auto + CR解析为Bracketed paste并提交；Text backend验证Auto解析为Direct且无marker残片。
* 保持独立`just test-029-codex-tui`：记录Codex版本，显式保持PasteBurst开启，用Macro Auto + CR提交本地`/quit`，断言requested/resolved evidence。
* 记录 raw replay与run-event write artifact证据。
* 使用隔离CODEX_HOME、假API key与拒绝连接的loopback base URL，确保不调用模型；Codex binary不可用时正式Gate必须BLOCKED/FAIL。

Gate：

* Codex smoke不依赖模型输出、API quota或Stop hook；成功oracle是出现 `Shutting down...` 并回到Bash prompt。
* Test结束时关闭TUI，不遗留child process。
* Write artifact精确匹配framed payload，bracketed markers不出现在Codex composer可见正文；Text Auto replay不出现marker；SKIP不能算通过。

## Phase 5: Current Docs、Focused Gate And Review

* Macro active spec、run-log active spec与Quickstart切到 delivery + ending current contract。
* Task index追加 `.029`，root child范围更新到 `.029`。
* 扩展现有`test:029` / `just test-029`与独立Codex TUI Gate入口，纳入Auto Shell/Text/resolver/UI evidence。
* 同时审阅代码和文档，逐项映射 `02_spec/01_contract.md` 的collision/resume/test contract与Legacy Kill List。
* 写 `04_review/01_result.md` 并回填 implementation/Close Gate状态。

正式命令：

* `just check`。
* `just test-029`。
* `just test-unit`。
* `just test-029-codex-tui`。
* `git diff --check`。
* Production/current docs/positive fixture Legacy Kill扫描。
* `.orig/.rej/.tmp` artifact扫描。

## Legacy Kill 基线与最终扫描

Auto扩展前基线已确认：

* Production已实现required`direct | bracketed-paste`、exact framing、collision、一次logical write与delivery event，但没有Auto resolver或`resolvedDelivery`。
* 三个editor constructor仍默认Direct，共享select只有两项且没有Auto tooltip。
* Text backend不解释bracket markers，显式Bracketed paste会把marker显示为正文；Auto必须在进入builder前解析为Direct。
* Current active specs与Quickstart仍是explicit两模式口径。
* Existing explicit Direct/Bracketed paste fixtures和template都是current合法输入，不批量rewrite；missing delivery negative evidence继续fail loudly。

收尾扫描分层执行：

* Production：不得有missing->Auto default、target rewrite、第二套resolver、unknown-capability fallback、builder直接吞Auto、第二次write/delay、Codex/process branch、wrapper config injection或current event缺requested/resolved evidence。
* Current Docs/UI：不得把raw CR称为universal Enter，不得保留两项旧option或Direct新建默认，不得增加Ending Auto或hidden fallback。
* Positive fixtures：所有send/input/parallel send必须显式写三值current delivery之一；新建surface evidence必须是Auto。
* Negative tests：只保留明确missing/invalid/alias失败证据；缺字段不得被解释为Auto。
* Historical task snapshots与append-only events：不回写，不计入current residue；本`.029`自身是当前未Close的任务文档。
* Local active templates：不迁移、不自动rewrite已有explicit值；旧missing shape继续不得回到active目录。

## 文件影响

* Contract：terminal delivery helper、`templateTypes.ts`、`flowV2Types.ts`、`flowV2Schema.ts`。
* Runtime/evidence：`server/macroRunnerService.ts`、Run Log demo/current evidence。
* Editor：`MacroStepList.svelte`、`ParallelLaneTabs.svelte`、共享 delivery/ending fields。
* Tests：schema/store/HTTP、recording/fake/input/parallel/real PTY、editor E2E、Codex TUI smoke及所有current fixtures。
* Docs/entry：Macro/run-log active specs、Quickstart、task index、package scripts、justfile、本 task review。

## Pre-review And Close Policy

AI pre-review必须确认：

* delivery与ending正交，没有把 paste-submit塞进 ending enum。
* Auto只按exhaustive Shell/Text capability解析；manual override优先，没有foreground process/DEC tracking/正文猜测或fallback。
* Collision与resume边界已冻结。
* 实测Gate覆盖用户报告的真实Codex行为。

AI post-review按P1/P2/P3与L1-L4报告；范围内L1/L2直接修复。实现、Current Docs、formal tests、Legacy Kill和review evidence全部完成前不得标记Close Gate通过。
