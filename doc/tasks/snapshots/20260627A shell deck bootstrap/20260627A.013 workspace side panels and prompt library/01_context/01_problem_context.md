# Problem Context

当前 shell-deck 主界面已经能跑 terminal deck 和 macro panel，但长期使用时有几个明显 UX 问题：

* Macro panel 不能隐藏，用户只想操作终端时右侧空间浪费。
* Macro panel 宽度固定，宏模板一长就很拥挤。
* Macro panel 高度没有直接占满 terminal deck 的可视高度，顶部空出一截，导致长宏更难浏览。
* 顶部 `shell-deck` 横栏偏高，挤压 terminal 和 side panel 的有效工作区。
* Macro panel 内按钮太多，普通动作和流程控制混在一起，视觉上太挤。
* 用户需要一个 Prompt Library，用来按项目和全局存储常用 prompt。第一版需要基本 CRUD、搜索、浏览和复制，不需要自动执行。

本任务把主界面从“terminal + 一个固定右栏”改成 workspace layout：

```text
compact top bar
────────────────────────────────────────
terminal deck │ macro side panel │ prompt side panel
```

设计目标：

* Macro 默认显示，Prompt 默认隐藏。
* 顶部按钮可控制 Macro / Prompt 显示隐藏。
* Macro / Prompt 都支持拖拽宽度、重置默认宽度。
* 显示隐藏状态和宽度按 config 保存，并在同 config 多浏览器 tab 同步。
* Side panels 的高度与 terminal deck 对齐：从 terminal tabs 顶部开始，到浏览器底部结束。
* Prompt Library 支持 project/config prompts 和 global prompts，提供新增、编辑、删除、搜索、浏览、复制。
