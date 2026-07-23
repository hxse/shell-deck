# Execution Plan

## 阶段一：framework与control inventory

* 建立App/Home/Macro/Library/notice的interactive-control与structural-border清单。
* 移除`app.css` explicit/system dark override，并将residue scanner恢复为built-in theme ownership。
* 冻结直接component class、禁止outline/control structural border和允许的不可见control例外。

阶段验收：static unit先对违规source和CSS owner建立正反例。

## 阶段二：原生component迁移

* 删除MacroPanel的input/select/textarea/button descendant emulation，仅保留排版与真正结构owner。
* 为Macro raw control直接添加`input`、`select`、`textarea`、`checkbox`或`btn` class；form control使用`box-border`、ghost与统一`bg-base-content/15` theme-derived fill，在无preflight前提下保持`w-full`不溢出。
* App、Home、Library、notice与Macro chrome移除`border-base-300` control、`btn-outline`、默认button surface及`btn-soft`，按primary/success/secondary/warning/error solid action hierarchy落地；仅tertiary chrome保留ghost。
* 对toolbar、palette group、status与普通card移除不必要border，以semantic background/card shadow表达层级；保留pane/popover/gutter/divider。
* saved Macro visual view移除ancestor/field text dimming，保留正常内容对比度，并由existing lock notice的info/warning/error semantic state表达read-only原因；normal `content_edit_lease_required` notice本身支持click与Enter/Space，委托既有`beginEdit()`获取lease，其他reason保持status-only。
* flow node在existing article上用Tailwind `::after`与primary/secondary/accent/info depth token恢复2px渐隐bottom separator；不增加DOM和CSS owner。

阶段验收：structure fingerprint无element delta，focused UI journey覆盖代表性control与state。

## 阶段三：验证与文档

* 把上一任务的contrast测试替换为native ownership、background和focus测试，保留business first-paint与valid system场景；在既有saved/read-only journey内覆盖notice click、keyboard与非normal reason的交互边界。
* 将随本任务增长的默认style Gate拆为Svelte semantics、Macro presentation、app.css/theme ownership与shared helper四个模块，原`checkUiStyleResidue.ts`只保留facade/CLI并维持既有import与just入口。
* 运行focused、full unit/integration/E2E、build、style residue和diff Gate。
* 同步active spec与Quickstart，明确dark theme使用built-in palette、控件靠component surface而非统一强边界。
* 回填review/index，检查jj stack、冲突与descendant；发生自动rebase冲突则先`jj undo`，不自行`jj resolve`。

## Legacy Kill List

* `src/app.css`中的14-theme selector、system-dark media owner、`base-300` mix和强制`--depth: 1`。
* production中的`btn-outline`。
* interactive input/select/textarea/button上的`border-base-300`。
* MacroPanel的`[&_input]`、`[&_select]`、`[&_textarea]`、`[&_button]`视觉模拟。
* 以3:1 structural border contrast代表control清晰度的测试与current doc口径。
* `business`中与base surface融在一起的默认`btn`和`btn-soft` command presentation。
* 普通input/select/textarea上的`bg-base-100/200/300`相邻shade fill。
* saved Macro view中的`text-base-content/55` field override和`.step-editor` ancestor opacity。
* 固定蓝色、legacy selector或额外DOM拥有的flow bottom separator。
