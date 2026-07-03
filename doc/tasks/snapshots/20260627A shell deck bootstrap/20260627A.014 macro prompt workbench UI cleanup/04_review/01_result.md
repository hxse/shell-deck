# Result

状态：implementation-landed；automated gate passed。

已完成：

* Macro workbench 改成 Macro title + Template summary + Reset width 的合并 header，并保留 run status dock；Start / Pause / Resume / Stop 放到 Editor 右侧 tool rail 顶部纵向排列，Actions/Flow 位于其下方。
* Run Log / AI Trace 收进 Macro 顶层 Trace tab，按 selected template 过滤，并通过 `run_log_updated` WebSocket 消息实时刷新，Refresh 仅保留在 Debug 折叠区。
* Prompt Library 改成 searchable selector + 统一操作栏，移除 Browse/Edit 平铺和 Preview 区。
* Flow V2 尚未接 compiler/interpreter，主 UI 隐藏不可执行的 Flow V2 控件，保留说明。
* Terminal tab close 明确纳入 .014：tab 内提供关闭按钮，关闭前确认，确认后走 `close_terminal` 协议并同步 deck。
* 更新 .014 GUI 回归，并同步旧 e2e 到新的 template selector / side panel 响应式行为。
