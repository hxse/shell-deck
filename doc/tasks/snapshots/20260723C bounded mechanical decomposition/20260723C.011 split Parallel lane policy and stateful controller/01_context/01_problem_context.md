# Problem Context

## 当前问题

controller前半包含纯lookup与capability判断，后半包含可在`updateDraft` callback内部执行的确定性mutation；真正需要Svelte state的只有collapsed action IDs和edit notice，selected lane仍由parent port拥有。

把pure部分留在`.svelte.ts`会让任何policy修改都触及stateful controller，也让单元测试必须间接装配UI ports。

## 拆分选择

policy只读传入definition/node/lane/terminal choices并返回值。commands只修改调用者显式传入的draft对象并返回structured success/reason/affected IDs；它们不调用confirm、不设置notice、不持久化reference。

controller负责live getter、confirm、notice、collapse/selection reconciliation，并且只在现有`updateDraft`内调用command。

## 风险边界

set ID的duplicate判定必须覆盖整个Macro node inventory；lane terminal改变前的外层precheck必须列出incompatible action并零mutation；add action不能越过final Output；remove lane必须同步selected lane、palette和collapsed IDs。机械拆分还必须保留两项父版本失败语义：`updateDraft` callback先adopt terminal再重查lane；action rename通过duplicate检查后即使目标action已消失也仍改写collapsed key并返回`true`。
