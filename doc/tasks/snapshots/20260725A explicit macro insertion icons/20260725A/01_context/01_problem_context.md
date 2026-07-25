# Problem Context

Macro node action bar 和 For text-list item 都提供相对当前项插入的 icon-only control。当前两处各自维护一套“横线 + 加号”SVG，而且视觉含义恰好相反：node 的 `Add before` 与 text-list 的 `Insert below` 几乎同形，node 的 `Add after` 又与 text-list 的 `Insert above` 同形。用户必须依赖按钮顺序或延迟出现的 tooltip 猜方向。

本任务采用已经确认的统一语言：

* `↑` / `↓`只表示移动当前项；
* `+↑`表示创建一个位于当前项之前的新项；
* `+↓`表示创建一个位于当前项之后的新项。

插入 SVG 只由 `MacroIconButton` 维护，`NodeActionControls` 不再手写第二套图形。这样既直接修复可见歧义，也避免两处图标再次漂移。
