# Result

状态：implementation-landed；automated gate passed。

本轮落地 `.013 workspace side panels and prompt library` 的 V0.1 实现切片：

* Top bar 压缩，并新增 `Macro` / `Prompt` 显隐 toggle。
* Workspace 主区域改为 `terminal deck | macro side panel | prompt side panel`。
* Macro panel 默认显示，Prompt panel 默认隐藏。
* Macro / Prompt panel 支持拖拽宽度和 `Reset width`。
* Panel visible/width 保存到 `.shell-deck/configs/<configId>/ui-layout.json`，并通过 WebSocket 同 config 多 tab 同步。
* Macro panel 增加 reset width 入口；保留 runner controls 固定在面板顶部，Actions / Flow palette 分区沿用 `.011/.012` 方向。
* 新增 Prompt Library：project/config prompt 与 global prompt 的 create/read/update/delete、scope filter、title/body/tag search、preview、copy body、delete confirm。
* Prompt 数据保存到 `.shell-deck/configs/<configId>/prompts/*.json` 和 `.shell-deck/prompts/global/*.json`。
* Prompt CRUD 通过 WebSocket 通知同 config tab；global prompt 变更通知当前 server 所有连接 tab。
* 新增 `just test-013` 专用 gate。

范围外保持不变：不自动发送 prompt 到 terminal，不做 prompt 变量替换，不把 prompt 绑定 macro，不实现 Flow V2 runner/compiler。
