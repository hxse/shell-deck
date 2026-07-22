# 20260722B.002 App Room and Terminal Chrome Migration

## 任务概括

使用`.001`提供的Tailwind/daisyUI foundation，迁移RoomHome、App topbar/Settings、Workspace outer shell、terminal tabs、Shell/Text terminal slot和NoticeStack的presentation。同步把xterm从固定hard-coded background/foreground改为由effective theme驱动的light/dark ANSI palette，且只更新现有instance option，不影响live terminal状态。

## 正式 task 级别及定级原因

三星任务。

本任务不改terminal protocol，但覆盖全高布局、flex/grid/overflow ownership、drag tabs、panel resizer、xterm renderer和live scrollback。视觉迁移若丢失一个`min-height: 0`、absolute inset或viewport overflow rule，就可能演变为实际terminal可用性回归，因此Code/Test Gate必须同时验证DOM、geometry与live PTY状态。

## 范围内

* 迁移Home、App room shell/topbar/control status、Settings popover和notice presentation。
* 迁移WorkspaceShell outer layout、side panel/resizer、terminal deck/stage、tab strip和empty state。
* 迁移Shell TerminalSlot与TextBoxSlot的chrome、metadata、editor/gutter和shared readonly state。
* 建立两套审计过的xterm ANSI palette及effective theme bridge。
* 删除已无consumer的旧rules/import/files，并给仍由`.003`消费的物理混合文件留下精确residue inventory。
* 增加structure/geometry/theme/terminal-retention focused tests。

## 范围外

* Macro/Library panel内部control、flow、trace、list和editor migration。
* 修改terminal create/close/select/drag/resize、WebSocket output、parser、view-state保存或Room controller逻辑。
* 新增terminal profile、terminal-specific user theme、per-slot palette或theme editor。
* 修改Settings controls结构、顺序或Theme lifecycle contract。

## 决策归属

AI可按formal component/style owner迁移并修复明显visual regression。若保留current layout需要新增wrapper、改变responsive breakpoint或重建xterm，说明实现路径错误，不能以本任务授权继续。
