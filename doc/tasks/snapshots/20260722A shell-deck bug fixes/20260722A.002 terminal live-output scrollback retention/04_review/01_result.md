# Review Result

## 结论

`20260722A.002` implementation、active spec同步与Close Gate完成。问题不是Codex TUI专属：Codex的高频repaint只是放大了`TerminalSlot`对每个live append无条件`scrollToBottom()`的既有错误；server/PTY output与xterm native scroll实现没有异常。

## 实现映射

* `TerminalParserWritePump.onUpdateParsed`只在authoritative `replace` hydration完成后显式定位到底部；live `append`完全交回xterm native follow-output语义。
* `fitToHost()`在grid resize前读取active buffer的`viewportY/baseY`，只在resize前位于底部时恢复bottom；用户查看历史时resize不再改变viewport。
* 没有新增scroll lock按钮、browser偏好、Room消息或持久化state；parser pump、replay/delta、retained xterm、Shell input与Text terminal均未改变。
* `roomLargeReplay032.spec.ts`通过真实xterm scrollbar slider拖动建立超过一屏的history，覆盖离底后的live output、离底状态下resize、主动回到底部及恢复follow，不使用组件私有API伪造状态。
* current `room_terminal_contract.md`同步上述唯一active truth；`just test-002`覆盖两组相关unit与完整六项large replay browser owner。

## 自审与直接修复

* P1：0 unresolved。
* P2：0 unresolved。实现保持两处局部条件判断，没有抽取viewport framework或改写xterm生命周期。
* P3：0 unresolved。自审时将focused browser Gate从只运行新增case扩为完整`roomLargeReplay032.spec.ts`，共同守住large burst、retained view、37 MB real PTY、reset与historical hydration。
* 需要用户拍板：无。

## Gate证据

* `just check`：TypeScript与Svelte均0 error、0 warning。
* `just build`：216 modules，production build通过。
* `just test-unit`：178/178 unit、53/53 integration。
* `just test-002`：14/14 focused unit、6/6 focused browser。
* `just test-e2e`：clean rerun为56/56 full browser journeys通过，新增真实scrollbar journey在两次full/两次focused执行中均通过。
* 首次full E2E为55/56：既有`.039` retained-view用例的160k fake burst在20秒时已持续消费至147400 code units但marker尚未到达；同owner隔离复跑6/6及随后full rerun56/56通过，未调整该既有timeout或产品吞吐代码。
* `just diff-check`通过；scope仅包含`TerminalSlot`两处scroll决策、同owner E2E/recipe、task docs与唯一相关active spec。
