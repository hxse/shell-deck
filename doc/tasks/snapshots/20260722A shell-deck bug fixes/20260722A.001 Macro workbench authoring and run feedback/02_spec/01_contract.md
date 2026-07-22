# Contract

## For text-list就地插入

* text-list头部不再提供远离目标位置的`Add item`文字按钮。
* 每个item的action group新增`Insert item above`和`Insert item below`两个icon-only按钮，继续保留Up、Down、Remove。
* 插入内容固定为`{ key: "", value: "" }`；above插入当前index，below插入`index + 1`。
* 插入后原item内容和相对顺序不变，至少一项、key/value、template binding与reorder contract不变。

## Active run只读与阶段反馈

active status精确为`starting | running | paused | waiting_input | stopping`。任一active status期间：

* Macro template selector、New/Edit/Save/Save to Library/Cancel/Delete、visual authoring fieldset和JSON Edit入口不可修改；已有draft/selection/dirty/lease不丢失。
* visual fieldset使用原生`disabled`并由统一mutation入口再次拒绝`macro_run_active`，不能仅靠透明度或pointer CSS伪装只读。
* editor顶部显示复用同一read-only surface的明确lock notice；controller缺失、pending operation、content lease与active run都使用该surface，但reason文案准确区分。
* run进入终态`completed | failed | stopped`后解除run lock，editability再按controller/edit session/lease判断。

Run dock必须把runner status作为独立badge，把`currentNodeId`解析为冻结`runningMacro.definition`中的`type · id`；Parallel lane action还显示lane。current stage使用独立`data-testid`和高对比边框，不再只是`step: id`小字。visual editor中匹配的root/nested node或Parallel lane action使用明显的current-node边框/阴影；当前node不在browser-local draft时不猜测、不切换selector，Run dock仍从frozen definition显示正确stage。

## App notification repeat hard cut

唯一current App channel shape改为：

```ts
type AppNotifyChannel = {
  kind: "app"
  toast: boolean
  sound: NotificationSound
  repeatCount: number
  repeatIntervalMs: number
}
```

* `repeatCount`是包含首次呈现的总次数，必须为1到10的integer。
* `repeatIntervalMs`是相邻呈现开始时间的间隔，必须为250到60000的integer；即使count为1也必须存在并合法。
* 新建App channel默认`repeatCount: 3`、`repeatIntervalMs: 1000`。
* Macro editor在App channel区域提供`Repeat count`和`Interval ms`number controls。
* 缺少任一字段、额外旧字段、fraction、NaN或越界值均由strict V5 validator拒绝；不补默认、不迁移、不dual-read。

server仍只执行一次Notify、生成一个notificationId并广播一条`macro_notification`。browser对该消息完成一次去重后，立即呈现第1次App toast/sound，再按interval调度剩余次数；`toast:false`不弹toast，`sound:none`不播放声音，两者均关闭时不产生App side effect。System browser notification和Telegram始终只发送一次。Room disconnect/destroy/clear必须取消未触发repeat timer；同一notification重放不得建立第二组timer。

## Parallel无text output authoring

Parallel schema、validator与runner完全不变。每条lane继续有且仅有一个final Output node；`source:{kind:"none"}`继续是明确不输出text，不是unassigned。

UI把final Output呈现为`Collect lane text`checkbox：

* unchecked精确写入`source:none`并隐藏Output id/source细节；lane仍可添加、移动和执行Send/Wait/Capture/Extract。
* checked时若存在earlier lane-local Capture/Extract artifact，自动选择最靠后的一个并显示Output id/source selector；不存在choice时保持unchecked并提示先添加Capture或Extract。
* 用户仍可在source selector中选`none`，其效果等同uncheck。
* 只有至少一条lane实际选择output source时显示Separator与Include empty outputs；`On lane fail`始终显示。
* 默认Parallel保持不收集text；本任务不增加持久化toggle或optional schema branch。

## Loop template controls

在in-scope scalar Title/Prompt与Message text part勾选`Use loop template`后，直接显示exact `{{index}}`、`{{key}}`、`{{value}}`三个按钮。按钮可wrap但使用紧凑高度、padding和11px字号，accessible title说明`Insert <token>`。

删除所有in-scope `Available: {{index}} · {{key}} · {{value}} · from ...`及shadow提示。out-of-scope error、template syntax error、caret replacement、focus/caret restore、one-pass rendering和S1-S6 whitelist保持不变。

## Primary files

* Macro schema/runtime：`src/lib/macro/macroDefinitionTypes.ts`、`macroNodeValidation.ts`、`macroEditorDefaults.ts`、`src/lib/protocol.ts`、`server/macroActionRuntime.ts`、`src/lib/roomNotificationDelivery.ts`。
* Macro UI/state：`src/lib/components/MacroPanel.svelte`及`components/macro/`内Run dock、editor shell、flow/text-list、Parallel、Notify与template controls的直接owner。
* 样式：`src/styles/macro-chrome.css`、`macro-editor.css`、`macro-flow.css`、必要的component-local style，以及仅用于保持notice高于failed insertion palette的`terminal.css`层级规则。
* current tests、`doc/tasks/active_specs/macro_template_contract.md`和必要的current architecture/run-log说明。

## Gate

* schema unit：App repeat exact shape、default与missing/fraction/range rejection。
* browser delivery unit：次数/间隔、dedupe、System once与clear取消timer。
* Macro browser：item above/below顺序、token button文案/尺寸/无hint、Parallel none/collect切换、active run fieldset disabled/lock notice/current stage/node highlight/终态解锁。
* runner/integration：notification payload保留repeat config且server只广播一次；既有Parallel no-output执行不漂移。
* `just check`、`just build`、`just test-unit`、受影响integration/current E2E、`git diff --check`与legacy App shape扫描。
