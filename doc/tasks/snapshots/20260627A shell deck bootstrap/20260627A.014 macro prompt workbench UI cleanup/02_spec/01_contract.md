# Contract

## Scope

范围内：

* Macro side panel 改为 Workbench 结构。
* Template 选择改为默认折叠的独立 Template drawer；折叠态只显示 selected template 简略信息。
* Template CRUD 按钮集中到一个 toolbar：New / Save / Duplicate / Import / Export / Delete。
* Editor / JSON / Trace tabs 保留，作为 Macro workbench 顶层视图。
* Start / Pause / Resume / Stop 放入 Editor tab 右侧 sticky tool rail 顶部，纵向排列，并位于 Actions / Flow 上方。
* 主路径移除 Macro runner Refresh；只允许作为 debug / recover 入口，不作为常用按钮。
* waiting input / input send 区必须用醒目的红色边框提示，避免用户错过。
* Macro header 将 Macro title、默认折叠的 Template drawer summary、Reset width 合并为同一行；Template 展开内容仍提供搜索、选择、CRUD。
* Macro run status / waiting input / input send 位于 Macro 顶部 dock，位置在合并 header 与 Editor / JSON / Trace tabs 之间。
* Actions / Flow palette 在 Editor 内显示为右侧独立 sticky tool rail，从 Editor tab 下方延伸到面板底部；Run controls 在该 rail 顶部，Actions / Flow 在其下方；这些工具不属于 Steps section，也不能插在 step editor 主纵向流里。
* Run Log 从 Macro panel 下方移出，成为 Macro 顶层 Trace tab 的内容。
* Trace tab 内必须提供 Run Log / AI Trace tabs。
* Run Log 必须实时响应 run event 变化，不能依赖用户手动 Refresh 才看到最新 run/event。
* Prompt panel 改为 searchable prompt selector + editor，不再 Browse / Edit 平铺。
* Prompt Preview 移除；body textarea 就是编辑和阅读入口。
* Flow V2 disabled 主按钮从主路径隐藏，避免用户误以为当前可点击。
* Terminal tab close 作为 .014 的小型 workbench chrome cleanup：每个 terminal tab 提供关闭按钮，点击前必须确认，确认后通过 `close_terminal` 删除该 terminal。

范围外：

* 不实现 Flow V2 runner/compiler。
* 不改变 v1 macro template schema。
* 不改变 prompt 存储格式。
* 不新增 prompt 自动发送到 terminal。
* 不改变 run log append-only 文件语义。
* 不实现 terminal close undo、session restore 或 terminal lifecycle recovery。

## Terminal Tab Chrome

* Terminal tab close 是本任务纳入的附带 UI chrome 行为，用于避免用户只能 reset 而不能移除不再需要的 terminal。
* Close 按钮显示在 terminal tab 内，点击必须先弹出确认；取消确认不得改变 terminal deck。
* 确认后 server 删除对应 terminal，并同步 deck snapshot / terminal index map 到同一 config 下的所有浏览器 tab。
* 该能力不绑定 macro template、Codex session 或 Prompt Library，也不改变 terminal id/alias 的语义。

## Macro Workbench Layout

目标结构：

```text
Macro side panel
┌───────────────────────────────────────────────────────────────┐
│ Header row: Macro · Template summary · Reset width            │
│ Template expand: search/select + CRUD toolbar                 │
├───────────────────────────────────────────────────────────────┤
│ Run status: status / runId / step / waiting input + Send      │
├───────────────────────────────────────────────────────────────┤
│ Tabs: Editor | JSON | Trace                                  │
│                                                               │
│ Editor: main editor + right sticky Run/Actions/Flow rail      │
│ JSON: structured template JSON                               │
│ Trace: Run Log | AI Trace for selected template              │
└───────────────────────────────────────────────────────────────┘
```

要求：

* Template 列表不平铺占据主空间。
* Template drawer 展开后必须支持搜索 title/name。
* 如果没有模板，selector 显示空状态。
* Template drawer 展开后，所有模板 CRUD 操作必须放在同一个视觉组。
* Delete 仍然必须确认一次。
* Editor / JSON / Trace tabs 控制的是 Macro 顶层视图。
* Trace tab 内的 Run Log / AI Trace tabs 控制 selected template 的追溯视图。
* Run controls 只在 Editor tab 右侧 tool rail 内显示，纵向排列在 Actions / Flow 上方；运行状态、runId、current step、pause reason、waiting input 和 Send 按钮放在顶部 sticky dock，不放在右侧 rail。
* Trace 必须跟随当前 selected template；切换 template 后，只显示该 template 的 run 列表和 snapshot。
* Flow V2 planned controls 不显示成 disabled 主按钮；可以在 JSON 或 Legacy/Advanced 区说明后续任务处理。

## Run Log Real-Time Contract

新增 WebSocket 事件：

```ts
{
  type: 'run_log_updated',
  configId: string,
  runId: string,
  eventSeq: number,
  kind: RunEventKind
}
```

触发规则：

* 任意 RunEventStore.appendEvent 成功后必须广播。
* createRun 通过 run_started event 自然触发。
* writeArtifact 通过 artifact_created event 自然触发。
* MacroRunner 内部事件、Run Log demo、HTTP append event 都必须走同一条广播路径。

前端规则：

* RunLogView 收到当前 config 的 run_log_updated 后自动刷新 runs 列表，并按 selected template 过滤。
* 如果当前选中的 runId 等于事件 runId，必须自动刷新 snapshot。
* 如果当前没有选中 run，收到第一个 run_log_updated 后自动选中最新 run。
* 手动 Refresh 不再放主路径；可以存在 debug/recover details 内。

## Run Log / AI Trace UI

Run Log tab：

* 显示 compact run selector / summary。
* Node logs 默认折叠。
* 每个 node summary 显示 title、scope、event count、error/missing artifact 状态。
* Artifact refs 可点击预览。

AI Trace tab：

* 显示同一份 RunSnapshot JSON，作为 AI 追溯入口。
* 不制造第二份日志真值。
* AI Trace 与 Run Log 使用同一个 snapshot 数据。

## Prompt Panel Layout

目标结构：

```text
Prompt panel
┌───────────────────────────────┐
│ Header: Prompts · Reset width │
├───────────────────────────────┤
│ Scope filter · Search         │
│ Prompt selector/dropdown      │
│ Toolbar: New project New global Save Copy Delete │
├───────────────────────────────┤
│ Editor: Scope Title Tags Body │
└───────────────────────────────┘
```

要求：

* Browse 列表不再与 editor 平铺。
* Prompt selector 必须支持 search 结果选择。
* selector 显示 title、scope、tags 的简短信息。
* Edit body textarea 是阅读与编辑入口；移除 Preview。
* Copy 仍然复制 body。
* Delete 仍然按 saved selected scope 删除，不能受未保存 scope 下拉影响。
* 收到远端 prompt 更新时沿用 .013 的 selected scope / moved event 规则。

## Acceptance

自动化 gate：

* `just check`
* `just test-014`
* `just test-unit`
* `just test-e2e`
* `git diff --check`

.014 专项 e2e 至少覆盖：

* Template drawer 默认折叠并与 Macro title 同行；展开后能搜索和选择模板，模板列表不作为平铺常驻主区。
* Template CRUD toolbar 在同一组内。
* Run controls 位于 Editor tab 右侧 tool rail 顶部并纵向排列，JSON/Trace tab 不显示 runner controls；顶部 sticky dock 显示 run status 和 waiting input/send。
* Trace 作为 Macro 顶层 tab，内部提供 Run Log / AI Trace tabs。
* Run Log 收到 run event 后自动刷新，不点击 Refresh 也能看到新增 run/node。
* Prompt selector/search 能选择 prompt，Preview 不存在。
* Prompt CRUD toolbar 在同一组内。
* Flow V2 disabled 主按钮不出现在主路径。
* input_line / waiting input UI 使用红色边框高亮。
* Terminal tab close 按钮必须先确认；取消保持 terminal，确认后 terminal 从 deck 中移除并同步。
* Actions / Flow 使用 Editor 右侧 sticky tool rail，位于 Run controls 下方，工具栏可独立滚动，且不参与 step list 的纵向流。
