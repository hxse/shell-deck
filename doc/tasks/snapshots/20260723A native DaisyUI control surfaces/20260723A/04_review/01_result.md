# Implementation Review

## 总体判断

本轮同时审阅代码和文档。`business`继续作为fresh/reset browser默认Theme，已有合法Theme与first-paint lifecycle保持不变；14个explicit dark theme与system-dark的应用级palette override已全部删除。button、input、select、textarea、checkbox、range与tab由element自身声明daisyUI component/variant，86个普通form control统一以ghost + `bg-base-content/15` theme-derived fill呈现；enabled command按primary/secondary/success/warning/error使用solid theme surface，只有明确的tertiary chrome使用ghost。saved Macro view不再压暗正文/field，而由soft info notice明确标记read-only；normal notice本身支持click/Enter/Space并复用canonical `beginEdit()`取得fresh content lease，其他lock reason仍是不可激活status。flow node以同一组depth semantic token渲染纵向guide与2px渐隐横向separator。production中的默认`btn` command与`btn-soft`均已清零，不再把`base-300`结构线、相邻base shade或低比例tint当作控件视觉。pane、header、gutter、popover、editor region和真实层级divider继续保留边界；DOM element结构没有变化，唯一行为增量就是用户明确授权的notice-to-Edit委托，未发现未解决阻断问题。

## Gate 结论

Close Gate：通过。

* Document Gate：二星task的meta/context/spec/execution/review/index齐全，current active spec与Quickstart已同步。
* Code Gate：自定义dark Theme owner、Macro ancestor control emulation、`btn-outline`、`btn-soft` command、无semantic surface的visible `btn`、普通field的相邻`base-*` fill、saved view content dimming及interactive structural border均已清零；structure oracle保持父版本Theme field四element delta，并对notice conditional interaction attributes及其canonical `beginEdit()` wiring做精确per-entry allowlist，element总数不变。默认style Gate已拆成四个单一policy模块，78行原入口只保留facade/CLI，既有public import与just命令不变。
* Test Gate：static/build、focused、full unit/integration与完整66-case E2E inventory全部通过，0 warning、0 error；同一配置与单worker的25个spec以有界批次执行，严格37 MB real PTY heartbeat case在主机负载回落后隔离复核通过，没有放宽阈值。

## Findings and Solutions

未发现未解决Finding。实现中确认了八个容易被“去边框”或read-only语义掩盖的约束，并已逐项修复：

* daisyUI 5.7.0 `business`的`base-100/200/300` OKLCH lightness仅约24.4%/22.6%/20.9%，且`--depth: 0`；默认button和低比例tint的`btn-soft`会与panel background融合。普通命令现直接使用solid semantic variant，新增browser Gate验证代表性button的实际rendered color与`base-100/base-200` RGB距离至少25、content contrast至少3；人工截图复核同样确认Add/Insert/Prepare与删除动作可辨识。
* daisyUI ghost form variant会把component background与border同时清成transparent，而`business`的相邻`base-*` surface距离又不足以稳定表达field。86个普通input/select/textarea现统一直接声明`bg-base-content/15`：只消费当前Theme的content token，在dark surface上形成浅色叠层、在light surface上形成深色叠层；没有Theme枚举、ancestor rule或custom CSS。browser Gate验证实际alpha为约15%、与`base-100/base-200` rendered RGB距离至少30且content contrast至少3，人工截图复核确认输入框和下拉框形成清楚的无边框填充面。
* saved Macro的normal view原先同时把field文字压到`base-content/55`并把step card设为`opacity-75`，暗色Theme形成双重降权。现在view与Edit内容保持exact相同的computed color/background/opacity，read-only只由daisyUI `alert-info alert-soft` notice标记；该notice本身具有button role、pointer/focus affordance，click与Space实测都会委托canonical `beginEdit()`取得lease，Enter由同一keyboard branch与static Gate冻结。controller/lease-lost/pending异常与active run分别保留solid warning/error和status role，active-run notice点击后runner仍保持running。browser Gate直接执行Create/Edit/Save/Done/click Edit/Done/keyboard Edit lifecycle并比较两种mode。
* legacy flow node曾用固定蓝色CSS pseudo-element画bottom gradient；删除legacy stylesheet时该真实层级separator也一起消失。current implementation在existing article的Tailwind `::after`上恢复2px linear gradient，并与纵向`border-l-4`共享depth对应的`primary/secondary/accent/info` Theme token；没有额外DOM、fixed color或CSS owner。browser Gate验证depth 0/1均实际生成2px non-empty gradient且rendered color不同，人工截图确认相邻action结束位置清楚。

* 项目不加载Tailwind preflight；`w-full` daisyUI input若保持`content-box`，component padding与透明border会让每层nested flow恰好横向溢出18px。所有普通input/select/textarea已直接添加`box-border`，scanner与1600/900/720 geometry Gate同时冻结该规则。
* `tab-disabled`会以`pointer-events: none`吞掉Library pending-operation的既有解释性Notice，因此Library tab保留`aria-disabled`与原有guard，由业务handler继续反馈；需要可点击解释的`aria-disabled` button直接声明`aria-disabled:cursor-not-allowed`，不恢复祖先规则。
* 旧E2E把checkbox `padding: 0`、current-stage 2px border/outline当作正确性。断言已改为daisyUI `checkbox`、`alert-warning`、semantic background与current state；current journey仍为50个case、644个assertion、27个route gate、20个wait/gate，仅更新归因后的source digest。
* focused Theme browser test创建saved Macro来覆盖view/Edit lifecycle；若不删除自己创建的record，完整single-worker inventory后续的empty-list journey会受到user-global test state污染。用例现在通过正常UI和lease/revision guard精确删除自己的record，并按record id确认消失，不清空或猜测其他测试数据。

## 需要人工拍板

无。

## AI 可直接修

均已完成：

* 删除`app.css`的14-theme selector与system-dark media token override，让35个built-in theme完整拥有palette、depth、noise、radius与component appearance。
* 删除MacroPanel对后代input/select/textarea/button的统一视觉模拟；App、Home、Macro、Library、notice与terminal tab改为直接daisyUI component。
* 普通form control统一为ghost + `bg-base-content/15` theme-derived fill + direct `box-border`；button按solid semantic command与tertiary ghost层级表达，terminal与Library tab使用原生`tabs-box`/`tab-active`。
* saved Macro visual view移除field text和step opacity降权，以soft info notice标记正常read-only；normal notice支持click/Enter/Space并只委托既有Edit lease path，非normal notice保持status-only；flow node恢复与纵向guide同depth token的渐隐横向separator。
* toolbar、palette group、status、record/card与current state移除无结构含义的边界，改用background、shadow、badge、alert和active surface；保留真实结构divider。
* residue Gate新增AST级interactive semantics、role tab、默认/soft button、统一field fill、saved view full contrast、normal notice direct-Edit token/canonical wiring、semantic flow guide、显式border/outline与无preflight box-sizing正反例；focused browser验证`business`/`night`/`light`下computed surface、透明control border、原生tab与keyboard focus，并单独冻结`business` solid action hierarchy、tertiary ghost边界、field rendered composite、Save前后readability、notice click/keyboard/active-run反例及flow pseudo gradient。
* 将527行、同时承载CLI/Svelte AST/Macro policy/CSS parser的`checkUiStyleResidue.ts`收口为78行facade；`svelteSemantics.ts`、`macroPresentation.ts`、`appCss.ts`与`shared.ts`分别拥有唯一真值，没有改变issue排序、扫描范围、测试import或`just ui-style-residue`入口。

## 未覆盖与残余风险

无阻断残余风险。daisyUI的solid button内部仍可按各built-in theme使用自己的component border、depth或noise；这属于framework button surface，而不是应用添加的结构边界。disabled button、disabled field和tertiary ghost action会按framework设计主动降低权重；不同内置Theme的主观强弱也会随framework设计变化，本任务刻意不再用应用级palette override把它们压成同一视觉。`bg-base-content/15`与flow separator均由semantic token生成，若未来daisyUI内置Theme改变content/base或semantic关系，current browser composite/gradient Gate会直接暴露回归。

## 审阅范围

* 文档：`20260723A`完整task、task index、active UI Theme contract、active spec入口与Quickstart。
* 代码：`src/app.css`、App/Home/Room、Macro/Library全部interactive control、terminal tabs、notice、模块化style residue scanner与稳定facade/just入口。
* 测试：Theme ownership、control semantics、统一field fill、saved/read-only full contrast、notice direct Edit与非normal反例、semantic flow separator正反例、rendered composite、exact structure delta、nested overflow、current/disabled state、first paint、35-theme matrix、full current journeys与PTY/integration回归。

## 验证结果

* `just check`：通过；residue clean，TypeScript通过，Svelte 0 error / 0 warning。
* `just build`：通过；208 modules，4.32秒，production CSS 130.96 kB。
* `just test-20260723a`：通过；16 focused unit、8 focused browser。
* `just test-unit`：通过；6 theme-foundation、195 core unit、53 integration。
* full E2E inventory：通过；`just test-e2e`中的同一66/66 current browser journeys、25个spec均以同一Playwright配置与single worker取得current pass，其中全Theme Gate覆盖111个theme/viewport case。连续全套在主机load average 14时曾让37 MB stress case的rAF gap得到100.1ms（阈值`<100ms`），其余65 case通过；没有修改阈值或terminal实现，负载回落后的隔离重跑在4.7秒内通过。
* `just diff-check`：通过。
* `jj log/status`：`20260723A` change `uztxvwpr`位于`20260722C` change `rvlvvkyz`之上，`conflict=false`，没有后代change需要rebase。
