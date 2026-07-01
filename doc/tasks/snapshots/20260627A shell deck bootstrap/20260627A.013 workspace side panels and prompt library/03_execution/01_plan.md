# Execution Plan

## Phase 1: Layout state foundation

目标：建立 config-scoped layout state。

工作项：

* 新增 `UiLayoutStore` 或等价模块。
* 保存 `.shell-deck/configs/<configId>/ui-layout.json`。
* 提供 GET/PUT API。
* WebSocket broadcast layout updates。
* 单测 identifier/path isolation。

验证：

```bash
just check
just test-unit
```

## Phase 2: Workspace shell layout

目标：改主界面结构，不先重做 macro 业务。

工作项：

* 压缩 top bar。
* top bar 加 `Macro` / `Prompt` toggle。
* 主区域改为 `terminal deck | side panels`。
* side panels 高度与 terminal deck 对齐，填满 viewport 剩余高度。
* Macro 默认 visible，Prompt 默认 hidden。
* 隐藏 panel 时 terminal deck 自动扩展。

测试：

* Playwright 检查 macro 默认显示。
* Prompt 默认隐藏。
* toggle 后显示/隐藏。
* reload 后状态保持。
* 第二个 tab 同步状态。

## Phase 3: Resizable side panels

目标：Macro / Prompt 都可拖拽宽度并持久化。

工作项：

* 增加 resize handle。
* 增加 `Reset width` 按钮。
* 设置 min/max width。
* 拖拽结束保存到 layout store。
* 同 config 多 tab 同步 width。

测试：

* Playwright drag resize macro。
* reload 后宽度保持。
* Reset width 恢复默认。
* Prompt panel 同样覆盖。

## Phase 4: Macro panel cleanup

目标：减少按钮拥挤，让 Actions 和 Flow Control 分栏。

工作项：

* runner controls 固定在 Macro panel 顶部。
* template CRUD 单独分区。
* Actions 纵向显示。
* Flow 纵向显示。
* Flow V2 未实现的按钮显示 planned/disabled，或仅在 prototype flag 下启用。
* legacy v1 flow buttons 不再作为主按钮成堆显示。

测试：

* Macro controls 可见且不被长模板挤走。
* Actions 区显示普通动作。
* Flow 区显示 `if/elif/else/for/break/continue/return`。
* 旧模板仍能打开。

## Phase 5: Prompt store and API

目标：交付 Prompt Library 数据层。

工作项：

* 新增 prompt record schema。
* 新增 project/config prompt store。
* 新增 global prompt store。
* 新增 CRUD API。
* 新增 search/filter API。
* 删除确认由 UI 负责，API 做路径和 scope 安全。

测试：

* Create project prompt。
* Create global prompt。
* List by scope。
* Search title/body/tag。
* Update title/body/tags。
* Delete project/global prompt。
* Path traversal rejected。
* Config isolation。

## Phase 6: Prompt panel UI

目标：交付用户可用的 Prompt panel。

UI 功能：

* Project / Global / All filter。
* Search input。
* Prompt list。
* New prompt。
* Edit prompt。
* Save prompt。
* Delete with confirm。
* Preview body。
* Copy body button。

测试：

* Prompt panel toggle。
* 新建 project prompt。
* 新建 global prompt。
* 搜索命中 title/body/tag。
* 编辑保存后 reload 保持。
* 删除需要 confirm。
* Copy 按钮复制 body。

## Phase 7: Integration and docs

目标：把 workspace side panels 纳入用户路径。

工作项：

* quickstart 增加 Prompt Library 简述。
* active spec 同步 workspace layout/prompt contract。
* e2e smoke 增加 panel layout + prompt CRUD。
* review/verification 记录人工 smoke。

## Close Gate

实现任务 close gate 建议：

```bash
git diff --check
just check
just test-unit
just test-e2e
```

新增专用 gate：

```bash
just test-013
```

`just test-013` 至少覆盖：

* layout state unit tests。
* prompt store unit tests。
* side panel GUI e2e。
* prompt CRUD GUI e2e。
