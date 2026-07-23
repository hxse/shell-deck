# Formal Contract

## 任务边界

允许新增`macroActionValidation.ts`和`macroControlValidation.ts`及必要的单一pure shared helper。`macroDefinitionValidation.ts`仍是public validation facade；production consumer不得直接选择部分validator绕过完整gateway。

## 任务规范

### Dispatcher与issue order

* `validateNodeList`的expected-array/non-empty issue、index traversal和action-only参数不变。
* 每个node依次执行object、ID、type、actionOnly semantic check、type-specific validation。
* 所有module追加同一`context.issues`，不sort、不dedupe、不并行。
* recursive If/For/control/Parallel child context与artifact registration时点不变。

### Action validator

Send、Notify、Input、Wait、Capture、Extract及message/templatable/filter/split/select/extract helpers的exact key、literal/range/reference和artifact output规则不变。

### Control validator

* If branch kind/order、Else、For range/template scope、Break/Continue loop depth和optional body不变。
* Parallel lane ID/label/terminal uniqueness、allowed action、final single Output、lane-local artifact visibility与merge规则不变。
* action-only nested body拒绝control node的path/message不变。

### 测试拆分

* 原12个test title和每个expect/fault input保持；只按core/action/control移动。
* `test:unit:core`显式发现全部新文件。
* pre/post case count、expectation count与每个test body semantic digest建立parity；不能只更新aggregate。

## 示例

正例：一个Notify同时包含非法sound、repeatCount和interval，issues继续按channels字段遍历顺序出现，path精确指向同一array index。

正例：Parallel lane在final Output前引用earlier local Capture合法；引用另一个lane artifact继续报相同path/code。

反例：先分别收集Action/Control issues再concat，会改变嵌套source order，禁止。

## 测试

* 保留“complete multi-issue code/path/message/order across value and JSON gateways”作为跨模块主oracle。
* action tests覆盖Notify、waitLimit、unassigned reference和capture/input/send字段。
* control tests覆盖text-list scope、optional body、negative select与Parallel output/artifact。
* static test冻结public facade与no direct production consumer。
* 正式Gate：`just check`、build、全部Macro validation/unit/integration及Macro editor E2E、`just diff-check`；本轮未执行。
