# Execution Plan

## 阶段一：baseline与共享lifecycle

* 冻结三个component source fingerprint、line count、palette formulas及browser focus/viewport baseline。
* 在`MacroInsertionPalette.svelte`增加module lifecycle owner。
* 两个parent保留相同变量/handler/markup，只用thin wrapper调用共享owner；先跑structure/focus Gate。

## 阶段二：Flow tree controller

* 移动collapse/branch key、node/If/text-list mutation与ID notice state。
* component以live ports装配controller，并保留recursive snippet/terminal/artifact/palette projection。
* 运行Flow defaults/commands/nested editor/current-node Gate。

## 阶段三：Parallel lane controller

* 移动lane/action/output mutation、capability、collapse与ID/label notice state。
* component保留selected lane/palette/render wiring与outer artifact composition。
* 运行lane layout/terminal capability/output collection与comprehensive behavior Gate。

## 阶段四：closeout

* 增加module boundary、no duplicate palette algorithm、single mutation gateway和exact structure断言。
* 运行static/build/full unit/E2E、同步active Macro/architecture contract与review/index。
* 确认完整jj stack `conflict=false`，回填root task Close Gate。
