# Review and verification

## 总体判断

20260729B范围已完成。新建Parallel默认显式`fail`，existing explicit pause/fail逐值保留；selected pane按`depth + 1`复用Flow semantic rail。run dock显示短`Prepare`并新增confirmed`Close all`；后者通过一个exact ClientMessage进入controller guard与terminal structure queue，在server冻结terminal ids、复用既有close lifecycle并合并为一份最终index map。

实现没有修改V6 schema、Parallel runtime failure算法、Prepare语义、Room lifecycle或持久化数据。没有新增component CSS、固定颜色、第二份terminal state或generic bulk framework。

## Gate结论

* Formal Document Gate：通过；task boundary、规范、示例、测试和execution plan完整。
* Code/Type Gate：`just check`通过，TypeScript/Svelte为0 error、0 warning，UI style residue clean。
* Build Gate：`just build`通过，Vite 7.3.6转换414 modules。首次sandbox内build无transform输出约2分钟后按资源保护要求中止；同一命令在sandbox外顺序重试，4.35秒通过。
* Unit Gate：`just test-unit`通过；283 core unit、7 log-storage、6 QR、4 access-control，以及该公开入口内串行的60 integration全部通过。
* Integration Gate：独立`just test-integration`再次通过，60项。
* Focused Gate：`just test-20260729b`通过，27 unit、1 WebSocket integration、3 single-worker E2E。
* Full E2E Gate：`just test-e2e`通过，Chromium 75/75，单worker，4.6分钟。
* Diff Gate：`just diff-check`通过。
* File-size Gate：扫描372个project-authored code文件，0 exception、0文件超过400行；新增`terminalDeckMutation.ts`为8行。
* Jujutsu Gate：当前change为`sysllmtv`，parent为`nxutvtll`（20260729A），`conflict=false`。

## Findings and Solutions

### 1. facade行数与职责

第一版把Close all组合方法放进398行的`TerminalRoomManager`并通过压缩空行维持上限。自审判定这不符合可读性目标，最终改为8行的具体`terminalDeckMutation.ts`：只组合manager现有`terminalPositions`、`batchTerminalIndexMaps`和`closeTerminal`，不持有状态、不做generic abstraction。manager恢复原398行。

### 2. Structure与test oracle

新增一个真实button及其prop wiring使workbench element fingerprint从742变为743，current project总element从845变为846；综合Macro journey增加一次dismiss confirmation evidence。测试使用scanner实际产出的per-file/aggregate digest精确更新，historical parent baseline未改，断言未删除或放宽。

### 3. disabled E2E fixture

active-run case没有terminal，Stop后Close all应继续因empty deck disabled。初始测试误期望enabled；产品代码未改，测试改为冻结active run时title为`Terminal structure is locked`，Stop后为`No Shell or Text tabs to close`。另一个mixed Shell/Text case覆盖normal enabled、Cancel、Confirm、最终empty disabled。

## 行为证据

* factory unit冻结新Parallel的`onLaneFail:"fail"`；E2E从fail切到pause再切回fail，证明selector能力保留。
* root Parallel pane投影depth 1/secondary rail，For内nested Parallel投影depth 2/accent rail，computed left border为4px。
* protocol接受exact`close_all_terminals`并拒绝附加terminalId。
* WebSocket integration证明observer收到`room_control_required`、run lock收到`room_structure_locked_by_run`、两次拒绝均零mutation；解锁后mixed Shell/Text全部关闭且observer只多收到一份最终index map。
* E2E证明Prepare control identity不变且短标签为`Prepare`；Close all Cancel保持三个tab，Confirm关闭全部tab并转为disabled。

## 需要人工拍板

无。

## AI可直接修

无遗留项。

## 残余风险

批量close复用live backend的既有不可逆close语义，不伪造rollback。若未来某个close lifecycle开始抛出异常，已完成的close不会恢复；当前contract要求该异常fail loudly且batch finally发布authoritative partial map。现有fake/text/real backend close路径和完整回归均通过。

## 审阅范围

审阅了20260729B新增task/current docs、Parallel factory与presentation prop chain、run dock/MacroPanel状态、ClientMessage parser、WebSocket mutation分类、terminal deck组合helper、control/structure inventories、unit/integration/E2E diff以及全部≤400行约束。
