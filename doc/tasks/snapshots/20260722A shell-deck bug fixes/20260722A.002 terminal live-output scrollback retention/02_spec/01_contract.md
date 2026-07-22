# Contract

## Live output follow

* 新建或`replace` hydration完成后viewport位于当前active buffer底部。
* 对`append` update，`TerminalSlot`不得在parse完成后无条件调用`scrollToBottom()`；由xterm维持其native viewport规则。
* 用户未离开底部时，后续output继续可见。
* 用户通过wheel、scrollbar或xterm API令`viewportY < baseY`后，后续output不得把viewport强制改为`baseY`。
* 用户主动回到底部后，后续output重新自然follow；不新增browser-local toggle或持久状态。

## Resize

* `fitToHost()`在`resize()`前读取当前active buffer是否位于底部。
* 只有resize前位于底部，才可在resize后显式`scrollToBottom()`；用户已查看历史时不得由fit、panel resize、tab activation或observer/controller变化强制到底。
* resize grid计算、controller-only shared PTY resize message与observer local fit保持原样。

## Frozen semantics

* `TerminalParserWritePump`的chunking、ordering、replace generation与stale target invalidation不变。
* server replay/delta、2 MiB browser Shell tail、8 KiB debug tail、terminal revisions及retained xterm instance不变。
* xterm default user-input scroll behavior不变；本任务只删除browser owner额外施加的bottom jump。
* Text terminal、Macro、Library、Room controller与terminal input/resize authorization不变。

## Primary files

* `src/lib/components/TerminalSlot.svelte`。
* `tests/e2e/roomLargeReplay032.spec.ts`或同owner的focused current browser test。
* 必要的task index、active spec与test inventory；不抽取generic viewport framework。

## Gate

* Browser regression构造超过一屏的Shell history，离开底部后发送多批live output，断言viewport仍不在底部且未跳回；主动回到底部后下一批output继续follow。
* 覆盖一次离开底部状态下的host/grid resize，断言fit不强制到底。
* 既有large replay、retained xterm、historical hydration、Room sync与full E2E保持通过。
* `just check`、`just build`、`just test-unit`、focused browser、`just test-e2e`和`just diff-check`通过。
