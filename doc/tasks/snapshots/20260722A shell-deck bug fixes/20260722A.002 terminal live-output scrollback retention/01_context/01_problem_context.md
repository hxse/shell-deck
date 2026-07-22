# Problem Context

`TerminalSlot.svelte`在每个`TerminalParserWritePump.onUpdateParsed`回调后无条件执行`current.scrollToBottom()`；`fitToHost()`在任何grid resize后也无条件执行同一操作。因此只要live terminal继续产生output，哪怕用户已拖动xterm scrollbar离开底部，下一批output也会覆盖用户的viewport选择。

Codex TUI会频繁发送cursor movement、screen repaint和状态更新，所以问题几乎立即复现；普通低频shell输出可能看起来正常，但owner中的无条件调用对所有Shell terminal都存在。xterm本身已经维护“在底部则follow、向上滚动则保留viewport”的标准行为，browser owner不应在每批append后覆盖它。
