# 20260627A.036 UI Touch Manifest

## 直接继承且默认不改

* `src/App.svelte`：继承`.035`的Room/Home、single-controller、terminal create、Settings、Notice与topbar视觉；只增加Library panel toggle、browser-local panel setting接线和Library event传递。Library toggle精确复用Macro的switch track/thumb与`aria-pressed`，不建立另一套按钮样式。
* `src/lib/components/workspace/WorkspaceShell.svelte`：继承`.034/.035`的terminal-first布局和Macro side panel；只在同级恢复Library side panel、resize handle及Macro load callback接线，不重排既有terminal/Macro DOM。
* `src/lib/components/MacroPanel.svelte`：继承完整Macro editor/JSON/Trace/runner行为；增加from-library create的request/response guard和fresh record选择入口，并在既有template toolbar局部增加`Save to Library`。不重排Flow editor，不改变Macro Save、Prepare或Start。
* `src/styles/base.css`、`src/styles/terminal.css`、`src/styles/macro-*.css`、`src/styles/room.css`：不因Library调整既有workspace、Macro或terminal视觉。`src/styles/run-log.css`只继承`.034`已冻结的统一panel switch与窄resize handle，不新增Library专用变体。

## Presentation reference与必要替换

* `.031 src/lib/components/PromptPanel.svelte`：保留panel header/status、toolbar、selector、metadata/editor、notice/error/dirty反馈及textarea输入手感；破坏性替换旧Prompt/configId/scope/store/routes为`.036` Library三kind、saved read-only、lease/revision与clipboard-only Copy。`Load into Macro`作为item级action进入上方toolbar，正文下方仅保留Validate。
* `.031 src/lib/components/workspace/WorkspaceShell.svelte`：保留右侧同级side panel、browser-local visibility/width/reset-width与resize interaction；panel名和data identity改为Library。visibility只隐藏常驻组件，不得以条件渲染销毁Library或Macro编辑状态。
* `src/styles/workspace-panels.css`：复用既有Prompt panel的密度、颜色、spacing和responsive规则，并以Library class扩展；只新增三tab、validation、只读状态和line editor所需局部样式。

## 新增文件

* `src/lib/library/**`：Library current-schema types、client与纯client state helper。
* `server/libraryStore.ts`：User Data Root内的exact record、canonical `(kind,itemId)`、stable search与transaction-compatible commit。
* `src/lib/components/LibraryPanel.svelte`：Library唯一UI consumer。
* `tests/unit/libraryStore036.test.ts`、`tests/integration/libraryHttp036.test.ts`、`tests/integration/libraryStoreProcess036.test.ts`、`tests/fixtures/libraryStore036Worker.ts`、`tests/e2e/libraryWorkbench036.spec.ts`：schema/store/API/lease/cross-process/Load与完整UI行为。

## 局部接线文件

* `server/httpServer.ts`：注册Library CRUD与from-library routes，复用controller、content lease、Macro validator/store和generic content invalidation。
* `src/lib/protocol.ts`：只在现有generic saved-content/lease消息无法表达时修改；不得新增browser-to-browser或Library专用重复同步协议。
* `src/lib/browserSettings.ts`：消费已存在的Library visibility/width/tab/filter字段，不恢复server UI layout或scope。
* `src/lib/macro/macroRecordClient.ts`：增加from-library fresh create方法；不增加Duplicate/clone。
* `src/lib/components/macro/MacroWorkbenchChrome.svelte`、`MacroTemplateSelector.svelte`：只接入显式`Save to Library`文字按钮和pending/permission状态，不改变其他toolbar交互。
* `src/lib/sharedMutationFeedback.ts`：仅补Library stable error的用户提示。
* `package.json`、`justfile`：增加`.036` Gate。
* `.031B` current inventory/journeys：只在`.036` revision加入Library controls及其完整用户旅程；历史`.031A/.031B/.032-.035`常量不回写。

## 明确禁止

不修改terminal tab/header、Macro toolbar/Flow层级、Home、Settings现有控件、全局字体/配色/图标、panel整体比例、Prepare/Start语义或runner同步。任何超出上述manifest的UI/CSS diff必须撤回或先在本task contract写出产品理由。
