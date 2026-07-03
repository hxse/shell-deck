# Problem Context

.013 已经让 Macro / Prompt 成为可显示隐藏、可调整宽度的 workspace side panels，但实际使用后暴露出明显信息架构问题：

* Macro panel 内 Templates 平铺，占用空间且长列表不可用。
* New / Save / Duplicate / Import / Export / Delete 分散在上下两处，用户不知道哪个按钮属于模板，哪个属于 runner。
* Start / Pause / Resume / Stop 与 editor/json 平级，层级不清晰。
* Run Log 被塞在 Macro panel 下方，内容很多，影响编辑；同时默认依赖手动 Refresh，用户无法判断当前 run 是否实时更新。
* AI Trace 只是 Run Log 末尾 details，不像一个面向 AI 追溯的独立视图。
* Prompt panel 把 Browse / Edit 平铺，空间利用差；Preview 与 Edit body 重复。
* Flow V2 按钮显示为主路径但全部 disabled，造成“功能坏了”的认知。

.014 的目标是把这些 UI 问题收束为一个 workbench 布局：Macro 顶层使用 Editor、JSON、Trace 三个 tab；Prompt 用 searchable selector + editor，而不是 browse/edit 平铺。
