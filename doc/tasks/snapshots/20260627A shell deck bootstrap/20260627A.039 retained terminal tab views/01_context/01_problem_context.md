# Problem Context

## 使用场景

用户在Shell中运行Codex TUI并积累很长会话历史，随后在Shell和Text tab之间切换。每次回到Shell，界面都会从上到下重新滚动一遍历史。退出Codex后replay仍在Room内，切换依旧重复发生。

## 根因

问题不在server、PTY或Codex。`WorkspaceShell`只把active terminal放进DOM，并用`{#key activeTerminal.terminalId}`包住pane。active id变化会触发：

1. 旧`TerminalSlot`执行`onDestroy`，dispose xterm和parser target。
2. 新`TerminalSlot`重新mount并创建空xterm。
3. `terminal.replay.join("")`作为replace update重新送入parser。
4. parser分块写完整历史并持续`scrollToBottom()`，用户看到明显滚动痕迹。

这也会让Text pane在切换时丢掉原DOM、selection和本地滚动位置。现有测试只证明历史terminal query在重复hydration时不会回灌PTY，反而把“切换会rehydration”误当成正常前提，没有冻结view identity。

## 方案取舍

选择lazy-retained view：只为当前active或此前访问过的terminal保留组件。未访问terminal不提前mount，避免一次性解析多个大历史；首次访问只hydration一次，之后切换只隐藏/显示同一个组件。隐藏的Shell继续处理live delta，保证terminal emulator状态与server输出连续；只有active Shell参与host测量和PTY resize。

不选择全量预挂载，因为Room中多个长历史terminal会放大首次页面加载。不选择固定数量LRU，因为eviction后再次点击仍会重放历史，直接违背本任务的用户语义。
