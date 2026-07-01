# Contract

## Scope

本任务定义 Workspace Side Panels 与 Prompt Library 的 V0.1 设计。

范围内：

* 压缩 top bar。
* Macro panel 显示/隐藏。
* Prompt panel 显示/隐藏。
* Macro / Prompt panel 拖拽宽度。
* Macro / Prompt panel 宽度重置。
* 面板显隐与宽度按 config 持久化，并同 config 多 tab 同步。
* Macro panel 内 runner controls 与 palette 重新排布。
* Prompt Library 基本增删查改。
* Prompt Library 搜索、浏览、复制。
* Project/config prompts 与 global prompts。

范围外：

* 不做 prompt 自动发送到 terminal。
* 不做 prompt 变量替换。
* 不做 prompt 执行历史。
* 不做 prompt 与 macro 自动绑定。
* 不实现 `.011` Flow V2 runner/compiler。
* 不改变 terminal PTY/input/capture 语义。

## Workspace Layout

目标布局：

```text
┌────────────────────────────────────────────────────────────┐
│ shell-deck · config · connected · New shell · Macro · Prompt│
├────────────────────────────────────────────────────────────┤
│ terminal tabs + terminal area │ Macro panel │ Prompt panel │
│                               │             │              │
│                               │             │              │
└────────────────────────────────────────────────────────────┘
```

要求：

* Top bar 必须压缩高度，只放全局工作区按钮和状态。
* Terminal deck 与 side panels 共享同一条主工作区 row。
* Side panels 顶部必须与 terminal tabs 顶部对齐。
* Side panels 底部必须到浏览器 viewport 底部。
* Macro / Prompt panel 横向并列显示在 terminal deck 右侧。
* 如果两个 panel 都隐藏，terminal deck 占满剩余宽度。
* 如果一个 panel 显示，terminal deck 自动收缩。
* 如果两个 panel 都显示，布局顺序为：`terminal deck | macro | prompt`。

## Top Bar Controls

Top bar 建议包含：

* `shell-deck` 标识。
* 当前 `configId`。
* connection 状态。
* `New shell`。
* `New fake`。
* `Drag tabs` toggle。
* `Macro` toggle。
* `Prompt` toggle。

规则：

* `Macro` toggle 控制 macro side panel 显隐。
* `Prompt` toggle 控制 prompt side panel 显隐。
* toggle 状态必须按 config 保存。
* 同 config 多浏览器 tab 改变 toggle 后，其他 tab 应同步。

## Panel Layout State

每个 config 保存一份 workspace layout state：

```json
{
  "schemaVersion": 1,
  "panels": {
    "macro": { "visible": true, "widthPx": 420 },
    "prompt": { "visible": false, "widthPx": 360 }
  }
}
```

默认值：

* Macro panel：`visible=true`, `widthPx=420`。
* Prompt panel：`visible=false`, `widthPx=360`。

宽度规则：

* 每个 panel 有 resize handle。
* 拖拽时实时更新宽度。
* 拖拽结束后持久化到 config。
* 每个 panel 有 `Reset width` 按钮。
* 默认最小宽度建议：`280px`。
* 默认最大宽度建议：单个 panel 不超过 viewport 的 `60%`，两个 panel 合计不应挤压 terminal 到不可用。
* 如果 viewport 太窄，panel 应进入 responsive fallback：优先保持 active terminal 可用，必要时提示用户隐藏 panel。

持久化规则：

* 不只存在 `localStorage`，因为 shell-deck 支持同 server 多 tab 同步。
* 推荐 server-side config 文件：`.shell-deck/configs/<configId>/ui-layout.json`。
* 客户端可用 local state 做乐观 UI，但 server state 是同步真值。
* layout state 不进入 macro template，不进入 prompt 文件。

## Macro Side Panel

Macro panel 仍是 macro template 与 runner 的主入口，但重新排布。

### Header / Runner Controls

Macro panel 顶部固定显示 runner controls：

```text
Start  Pause  Resume  Stop  Refresh
```

要求：

* runner controls 不要被长模板列表挤到不可见。
* runner controls 与 template CRUD 分区。
* `Stop` / `Pause` 只作为 runner controls，不作为新 flow template 节点。

### Template CRUD

保留：

* New
* Save
* Import
* Export
* Delete with confirm
* Template name
* Description

### Palette Redesign

Macro panel 内普通动作和流程控制分为纵向独立栏。

Actions：

* `send_line`
* `input_line`
* `sleep`
* `wait`
* `capture`
* `parse`
* `parallel_all`

Flow：

* `if`
* `elif`
* `else`
* `for`
* `break`
* `continue`
* `return`

说明：

* Flow palette 对齐 `.011 Flow V2` 方向。
* 在 Flow V2 实现前，Flow palette 可以先显示 disabled / planned 状态，或只在新 schema prototype 中启用。
* 不再把旧 `branch/goto/complete/pause/stop/fail` 作为新 GUI 主按钮成堆展示。
* 旧 v1 模板仍可编辑，但 legacy flow 节点应显示 legacy badge。

## Prompt Side Panel

Prompt panel 是新的 Prompt Library。

默认：

* Prompt panel 默认隐藏。
* 用户点击 top bar `Prompt` toggle 后显示。
* 宽度默认 `360px`，可拖拽，可重置。

### Prompt Scope

Prompt 支持两类 scope：

* Project / config prompts：只属于当前 `configId`。
* Global prompts：同一个 shell-deck server 下所有 config 可见。

建议存储：

```text
.shell-deck/prompts/global/<prompt-id>.md
.shell-deck/configs/<configId>/prompts/<prompt-id>.md
```

可选索引：

```text
.shell-deck/prompts/global/index.json
.shell-deck/configs/<configId>/prompts/index.json
```

如果使用单文件 JSON 存储，也必须保证：

* prompt id 遵守 Identifier Contract。
* global/project scope 明确。
* 删除可恢复策略明确，至少不能误删其他 config prompt。

### Prompt Data Model

最小 prompt record：

```json
{
  "schemaVersion": 1,
  "promptId": "review-task",
  "scope": "project",
  "configId": "local",
  "title": "Review Task",
  "body": "审查当前任务，只输出 P1/P2/P3。",
  "tags": ["review"],
  "createdAt": "2026-07-01T00:00:00.000Z",
  "updatedAt": "2026-07-01T00:00:00.000Z"
}
```

V0.1 必填字段：

* `promptId`
* `scope`
* `title`
* `body`
* `createdAt`
* `updatedAt`

可选字段：

* `configId`，project scope 必填。
* `tags`。
* `description`。

### Prompt CRUD

Prompt panel 必须支持基本增删查改：

* Create：新建 project/global prompt。
* Read：浏览列表，查看 prompt body。
* Update：编辑 title/body/tags/scope。
* Delete：删除前确认一次。

删除规则：

* Delete 必须二次确认。
* 删除 project prompt 不能影响 global prompt。
* 删除 global prompt 需要清楚标识 scope，避免用户误删。

编辑规则：

* body 用 textarea 或 markdown editor 的最小版本即可。
* 保存后更新 `updatedAt`。
* title 不能为空。
* body 可以为空，但 UI 应提示空 prompt。

### Prompt Search / Browse / Copy

V0.1 必须支持：

* 搜索 title。
* 搜索 body。
* 搜索 tag。
* scope filter：`Project` / `Global` / `All`。
* 列表浏览。
* 选中 prompt 后 preview body。
* Copy 按钮复制 body 到 clipboard。

不要求：

* 自动发送到 terminal。
* 自动插入 macro。
* prompt 变量替换。
* prompt 版本历史。

## Multi-tab Sync

同 config 多 tab 必须同步：

* Macro panel visible。
* Macro panel width。
* Prompt panel visible。
* Prompt panel width。
* Prompt CRUD changes。

允许实现方式：

* WebSocket broadcast layout/prompt updates。
* 客户端收到 broadcast 后刷新 panel state。
* 如果 prompt editor 有未保存 draft，收到远端更新时必须提示冲突，不可静默覆盖。

## API Direction

建议新增 API：

```text
GET  /api/configs/:configId/ui-layout
PUT  /api/configs/:configId/ui-layout
```

Prompt API：

```text
GET    /api/prompts?configId=:configId&scope=all&q=...
POST   /api/prompts
GET    /api/prompts/:promptId?configId=:configId&scope=...
PUT    /api/prompts/:promptId
DELETE /api/prompts/:promptId
```

或者按 scope 分路径：

```text
GET    /api/configs/:configId/prompts
POST   /api/configs/:configId/prompts
PUT    /api/configs/:configId/prompts/:promptId
DELETE /api/configs/:configId/prompts/:promptId

GET    /api/prompts/global
POST   /api/prompts/global
PUT    /api/prompts/global/:promptId
DELETE /api/prompts/global/:promptId
```

实现时需要先拍板 API 形态。推荐 scope 分路径，权限和路径隔离更清楚。

## Security / Safety

* prompt id 必须使用 Identifier Contract，禁止路径穿越。
* prompt body 是用户文本，不执行。
* preview 必须按文本渲染，不插入 HTML。
* clipboard copy 只复制 body。
* global prompt 删除必须显示 global scope。
* panel layout 文件不能被 prompt import/export 覆盖。
