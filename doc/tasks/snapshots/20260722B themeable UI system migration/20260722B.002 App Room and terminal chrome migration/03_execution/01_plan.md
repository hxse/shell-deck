# Execution Plan

## 1. 建立consumer与geometry baseline

* 映射四个legacy CSS文件的selector到本任务或`.003`component consumer。
* 记录listed component DOM/test-id inventory和1600/900/720关键bounding box、overflow/scroll owner，并冻结640/680/980/1100/1260的inclusive边界结果。
* 为xterm补充theme-change时object identity与view-state focused test，使用按需event bridge返回snapshot，不向production DOM追加状态attribute。

## 2. 迁移App与Home chrome

* 在existing markup上迁移RoomHome、room shell、topbar、control status、Settings和NoticeStack。
* 使用semantic state和compact utility保持current positioning、z-index、dismiss layer和control height。
* 移除对应base/room/terminal legacy selectors，逐步运行focused browser test。

## 3. 迁移Workspace与slots

* 迁移WorkspaceShell outer layout、side panel/resizer、terminal deck/stage和TerminalTabBar。
* 迁移TerminalSlot chrome/host与TextBoxSlot editor/gutter，保留dynamic width/transform style。
* 逐viewport核对`min-height: 0`、flex shrink、absolute inset和overflow ownership；所有父`max-width`边界改用显式inclusive media variant。

## 4. 接入xterm bridge

* 建立两份完整ANSI palette和canonical effective appearance mapping。
* initial create与runtime change均向同一xterm instance设置theme option。
* 回归scrolled viewport、bottom follow、resize、selection和continued live output。

## 5. 清理与自审

* 删除本任务已迁移selectors和空file/import；输出所有remaining mixed-file selector及`.003`consumer。
* 扫描hard-coded UI colors、xterm固定background override、dynamic class和非Theme-selector DOM diff。
* 执行formal Gate并按P1/P2/P3修复/记录，不提前声明root CSS closeout。
