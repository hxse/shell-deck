# Blueprint Contract

## 任务边界

`20260723C`只改变源码与测试的文件组织。允许新增internal module、移动函数/type/test case、收窄consumer、删除不再执行且可由jj历史恢复的退役test source，以及增加静态file-size Gate；不允许增加产品语义、改变public consumer或把current测试迁就为更弱的oracle。

最终仓库不存在超过400行的project-authored code source，也不存在path、digest、fixture、generated名称或historical豁免。`tests/e2e/comprehensiveUiBehavior031B.historical.ts`已经退出current Playwright discovery，由`.013`删除；`.031B` control inventory baseline独立保留。VCS metadata、dependency、runtime cache与build/test output不属于project-authored source，由scanner的明确directory classification跳过。

## 任务规范

### 全局不变量

* public API、protocol message、HTTP shape、persisted schema与现有error code/string不变。
* server revision递增、authorization check、await、callback、atomic publish、durability recovery与broadcast顺序不变。
* Room、runner、Macro、Library和Workspace state各自只有一份；coordinator只能通过live getter/command/commit ports访问owner state。
* Svelte factory/component可以把局部state移给唯一controller owner，但不得同时保留mirror rune、snapshot cache或第二个commit gateway。
* DOM hierarchy、element/attribute inventory、control order、test id、focus、Escape、resize、clipboard与current presentation不变。
* validation issue的`code/path/message/order`及value/JSON gateway结果不变。
* 测试case、title、assertion、fault injection、forced Gate与coverage attribution不减少；测试拆分只移动证据。
* 每个project-authored production、test、tool、config与native helper source在`.014`完成时均不超过400行。

### Child序列

1. `.001`：Evidence segment storage、record validation与public store。
2. `.002`：Macro live-run lifecycle、pause/input与snapshot publication。
3. `.003`：content edit lease state persistence/codec与业务事务。
4. `.004`：Room client presence/heartbeat与controller lease。
5. `.005`：terminal backend launch/callback与CWD lifecycle。
6. `.006`：Room registry/lifecycle与`TerminalRoomManager` public facade。
7. `.007`：Workspace message synchronization与reconnect coordination。
8. `.008`：Macro record navigation/edit orchestration；factory保留唯一rune state。
9. `.009`：Library list/navigation/edit orchestration；factory保留唯一rune state。
10. `.010`：Macro action/control validation及对应大unit test。
11. `.011`：Parallel lane pure policy/commands与stateful controller。
12. `.012`：Macro Flow insertion controller与recursive presentation。
13. `.013`：mutable Macro/Room E2E及control inventory拆分，并删除退役historical source与hash-only oracle。
14. `.014`：建立零豁免、覆盖全项目authored code类型的400行Gate，完成完整验证与root closeout。

child必须串行实现。后一个child不得复制前一个child尚未稳定的state或用adapter绕过其public facade。

### Change与Gate规则

* root与每个child各占一个change，description为`task <task_id> <title>`。
* 当前文档阶段可以预建全部change；实现阶段仍严格按`.001 -> .014`推进。
* 每个child先由人工确认Formal Document Gate，再补AI pre-review；Code/Test Gate通过后才实现下一个。
* 每次编辑早期change后立即检查全部后继`conflict=false`。出现冲突时停止、`jj undo`本次操作，不使用`jj resolve`。
* `.014`之前不得把400行限制临时接入默认Gate；`.014`负责在全部目标文件已达标后一次收口，避免中间态阻断前序child。

## 示例

### 正例：单一state通过ports拆分

`macroRecordSession.svelte.ts`继续声明`draft/editLease/dirty` rune。新navigation或edit orchestrator每次操作读取factory提供的live snapshot，并把明确outcome交回factory commit；模块自身不保存第二份record或draft。

### 反例：为了行数复制状态

把`selectedRecord`复制到controller cache，再用effect保持同步，即使文件都小于400行也不合格；它引入了两份真值和新的race。

### 正例：测试只移动

Room E2E的existing test body可以按case移动到多个`.spec.ts`，test title、步骤、断言和fault injection保持原样，public discovery与inventory同时精确登记新路径。

### 失败例：通过删断言满足上限

删除expect、把多个明确case合并成一个宽泛smoke，或只更新aggregate digest而不证明pre/post evidence parity，必须阻断当前child。

### 退役historical source

`.031B` historical journey不属于current Playwright contract，不通过拆分或改名继续留在source tree。`.013`删除该文件与raw-byte hash断言；`.014`不再建立file-size专用分支。jj历史承担旧源码追溯，结构化control inventory baseline继续承担当前需要的历史对照。

## 测试

每个child至少需要：

* source/module ownership与consumer boundary test；
* 对应domain的focused unit/integration/E2E；
* `just check`、production build与`just diff-check`；
* warning、structure drift、duplicate implementation、state cache或conflict均阻断完成。

`.014`必须运行：

* 默认file-size Gate，报告全部扫描文件并证明没有任何豁免；
* `just check`、production build；
* 完整unit与integration；
* 完整Playwright E2E；
* test inventory、structure、style、import boundary与`jj conflict=false`审计。

本轮只完成文档，不把上述Code/Test Gate标记为已通过。
