# Result

## 当前状态

`.029` 的 required Auto/Direct/Bracketed paste contract、target-aware resolution、shared wire builder、collision/resume、三个editor surface、Current Docs、真实Shell/Text/Codex Gate和三路post-review均已完成。本task范围内P1/P2/P3已清零，Close Gate通过。

当前设计真值已同步到`doc/tasks/active_specs/macro_template_contract.md`、`doc/tasks/active_specs/run_log_contract.md`与`doc/guides/001_quickstart.md`。当前jj change为`luknsqyr`，description是`task 20260627A.029 terminal input delivery modes`；没有创建新task或执行`jj new`。

## 实际修改

### Current schema 与 resolution

* 唯一requested type是`TerminalInputDelivery = "auto" | "direct" | "bracketed-paste"`；actual type只包含`direct | bracketed-paste`。
* `delivery`继续是required own-enumerable field。Missing、undefined、alias、wrong-case、inherited、non-enumerable或unknown value在schema/store/HTTP/start全部fail loudly；missing不解释为Auto。
* 唯一resolver按current target capability解析：Shell -> Bracketed paste，Text -> Direct bytes；explicit Direct/Bracketed paste永远保持原值。
* Backend与capability mapping都是exhaustive；future unknown kind fail loudly，不fallback。
* Existing explicit template仍是current合法输入，不迁移、不rewrite；当前local active template的explicit Direct原样保留。

### Runner、wire 与 evidence

* Shared write path在actual send/submit时读取current terminal snapshot；runtime input等待期间reset Shell -> Text后会按submit时snapshot解析Direct。
* Builder只接受resolved mode。Direct写`content + ending`；Bracketed paste写`ESC[200~ + content + ESC[201~ + ending`，且每个action只有一次runner logical`manager.input`。
* Current`terminal_text_sent`同时记录requested`delivery`、actual`resolvedDelivery`和`ending`；content/write artifacts分别保存裸正文与exact wire。
* End marker collision按resolved mode判断：Auto Shell zero-write拒绝，Auto Text按Direct原样允许；既有send/input/parallel resume语义不变。
* Fake Shell模拟Readline消费完整bracket framing；pasted newline在closing marker外的ending到达前不submit，普通ESC行为保持原样。

### Editor 与 Current Docs

* Normal send、input和parallel send新建时显式写`delivery:"auto"`、`ending:"cr"`。
* 三个surface共享精确三项：Auto (recommended)、Direct bytes、Bracketed paste；Ending仍只有None/CR/LF/CRLF，不增加Auto。
* Shared help使用focusable button与真实`role="tooltip"`；hover和keyboard focus都显示冻结文案。
* Shell↔Text target change与parallel lane propagation不修改requested delivery；manual override在preview/save/reload/duplicate/export保持原值。
* Current active specs、run-log contract和Quickstart已同步Auto mapping、manual override、Ending边界、collision与requested/resolved evidence。

## Post-review 修复

Document/Execution pre-review先发现并修复：active-spec同步状态写早、execution plan误称重复新增既有组件/test入口、tooltip只冻结文案未冻结可观察触发点、manual target-change矩阵和默认CR oracle不足。修复后Document Gate与Execution Gate无P1/P2/P3。

三路post-review分别覆盖core、UI/docs与tests/Legacy Kill：

* Core无P1/P2；发现P3/L1：Fake Shell测试一次发送完整payload，不能严格证明pasted newline未提前submit。已拆成begin+multiline与end+CR两次write，在ending前断言无`ECHO:`，随后断言只提交一次；focused test与完整`.029` Gate重跑通过。
* UI/docs无P1/P2/P3；共享tooltip、三surface defaults、Shell↔Text/lane propagation和Current Docs一致。
* Tests/Legacy无实现P1/P2/P3；唯一流程finding是缺少本review与index收口，已由本文件和最终状态更新关闭。

用户随后报告Input delivery字体大于相邻字段。根因是共享组件为容纳tooltip把select放在label外，select因此继承Macro panel默认字号，而普通字段从label继承统一field typography。已把label/select接入全局`macro-field-typography`规则并删除组件私有字号/字重；新增Chromium computed-style oracle，逐项断言Input delivery与Ending sequence的font family/size/weight一致。`just check`与focused workbench E2E重跑通过。

没有需要用户拍板的遗留项。

## 验证结果

| 命令 | 结果 |
| --- | --- |
| `just check` | 通过：svelte-check 0 errors、0 warnings |
| `just test-029` | 通过：89个Bun tests、692 assertions；6个Chromium E2E通过 |
| `just test-unit` | 通过：261 tests、1469 assertions；真实Codex smoke被明确排除 |
| `just test-029-codex-tui` | 通过：`codex-cli 0.144.1`，1 test、5 assertions |
| `git diff --check` | 通过 |
| Legacy/current residue扫描 | 无额外Auto子任务、missing->Auto default、migration/alias、second resolver、unknown fallback、Ending Auto、process/Codex branch或current event缺resolved evidence |
| `.orig/.rej/.tmp`扫描 | 无残留文件 |

Chromium首次在宿主缺少共享库路径时未进入测试；使用本机Nix Steam runtime的64-bit library path后，完整6个E2E实际执行并通过。Vite仍报告既有`>500 kB`chunk-size advisory，属于范围外非阻断项。

真实Codex Gate使用隔离`CODEX_HOME`、假API key、拒绝连接的loopback provider与`disable_paste_burst=false`。Macro requested Auto、resolved Bracketed paste，write artifact精确为`ESC[200~/quitESC[201~CR`；随后观察到`Shutting down...`、Codex exit与Bash prompt返回，不依赖模型输出或quota。

## Legacy Kill List 结果

* Production没有optional delivery、missing default、alias、migration、dual schema、target rewrite、第二套resolver或silent fallback。
* Builder不能接收unresolved Auto；runner没有fixed delay、paced typing、两阶段write、Codex/process识别或wrapper配置注入。
* Positive fixtures显式使用三个current value之一；missing/invalid只保留fail-loudly negative evidence。
* Historical append-only events保持历史原样；没有回写或为Macro JSON增加legacy reader。
* Auto没有拆分为额外子任务、index或test入口；完整归属`.029`。

## 残余风险与范围外

* Auto只看Shell/Text capability，不检测Shell tab里的foreground程序是否启用DEC mode 2004；不支持时用户可显式选择Direct bytes。
* 用户显式对Text选择Bracketed paste时marker可见是manual override的预期结果。
* Exact closing marker不能作为resolved Bracketed paste正文发送；当前contract选择fail loudly，不做escaping或fallback。
* 本任务保证一次runner logical dispatch与有序input stream，不声称长payload只有一次OS-level`write(2)`。

## Close Gate 结论

Document Gate、Execution Gate、Schema/Store/HTTP Gate、Resolver/Runner/Wire/Collision Gate、Editor/Current Docs Gate、真实Shell/Text/Codex Gate、三路post-review、Legacy Kill和正式自动化验证全部完成。本task范围内无未解决P1/P2/P3；`20260627A.029` Close Gate通过。
