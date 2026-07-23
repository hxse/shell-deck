# Formal Contract

## 任务边界

允许新增`parallelLaneEditorPolicy.ts`和`parallelLaneEditorCommands.ts`或等价pure模块。`createParallelLaneEditorController`的options/return及`ParallelLaneTabs.svelte`consumer不变。

## 任务规范

### Pure policy

* lookup只遍历传入Flow tree，不缓存Parallel/lane/output。
* terminal type/choice、allowed action/capture kinds、incompatible action IDs与unavailable lane terminal values结果不变。
* output source choices继续只包含同lane、final Output之前的compatible artifacts。
* pure function不得读取DOM、confirm、rune或global mutable state。

### Pure commands

* command只在传入draft上执行现有mutation，并以result报告success/reason/renamed/removed IDs。
* duplicate lane ID/label/action/output ID、terminal adoption、add/remove/move、collect text/source规则不变。
* add action插在final Output之前；Output不可move/remove为普通action。
* 失败路径精确保留父版本顺序与副作用：controller的incompatible precheck仍零mutation；进入`updateDraft` callback后，terminal adoption先于Parallel/lane重查，因此lane在callback draft中消失时可能已改变layout。

### Stateful controller

* collapsed action IDs与edit notice仍只有一个rune owner。
* selected lane继续使用parent getter/setter，不复制。
* controller调用唯一`updateDraft`；一次用户command不得产生第二个commit gateway。
* confirm与全部现有notice文字、collapse ID reconciliation、palette close/focus行为不变。action ID通过duplicate检查后，即使callback未找到目标action，也仍按父版本改写collapsed key并返回`true`。

## 示例

正例：将lane改到不支持terminal-quiet的Text terminal。policy返回不兼容Wait ID，controller显示原notice且不调用有效mutation。

正例：action ID改名成功后，若原IDcollapsed，controller同步唯一collapsed list为新ID。

父版本等价例：外层precheck看到lane，但`updateDraft` callback收到的draft中lane已消失；canonical terminal adoption仍先发生，command随后报告`lane_not_found`。这项行为不在机械task中修复。

反例：pure command内部调用`options.updateDraft`、`confirm()`或保存last draft，均不再pure。

## 测试

* 扩展`macroFlowVisualEditor006`直接测试pure policy/commands与controller state reconciliation。
* `flowV2EditorCommands034`/Macro validation冻结definition invariant。
* Macro layout/flow/comprehensive E2E冻结terminal choices、lane action、output、notice和control order。
* structure oracle证明parent DOM/attributes/class不变。
* 正式Gate：`just check`、build、focused unit/E2E、`just diff-check`；本轮未执行。
