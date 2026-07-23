# 20260723C.005 Split Terminal Backend Launch Callback and CWD

## 任务概括

`server/terminalBackendCoordinator.ts`当前444行，同时编排terminal mutation、backend candidate launch/synchronous callback buffering、output/exit/error generation guard，以及Shell CWD resolve/debounce refresh。本task把backend lifecycle与CWD lifecycle拆为internal模块，原coordinator保持manager调用surface。

## 正式 task 级别及定级原因

三星任务。PTY backend可以在`start()`同步回调；candidate只有经过ticket active检查并commit后才能发布。旧launch callback、CWD timer和async close都必须绑定exact terminal generation，错误会让stale backend污染新terminal。

## 范围内

* 抽出candidate launch/callback/close lifecycle。
* 抽出CWD resolve、debounce、refresh/cancel lifecycle。
* coordinator继续拥有create/input/Text/resize/reset/close public internal API与Room mutation ordering。
* 所有文件不超过400行。

## 范围外

* 不改TerminalRoomManager public API、backend interface、protocol或terminal runtime schema。
* 不改变Fake/Text/Real backend选择、HOME/default cwd或replay/revision语义。
* 不改变Room registry/controller；分别由`.004/.006`承接。
