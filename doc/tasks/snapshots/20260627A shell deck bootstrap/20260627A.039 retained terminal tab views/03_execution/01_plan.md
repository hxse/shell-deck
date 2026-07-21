# Execution Plan

## 阶段一：冻结回归

1. 在现有large replay browser suite增加DOM identity、parser work和lazy mount断言，先证明当前实现因tab切换失败。
2. 将历史query测试的真正hydration入口改为page reload，不再把tab切换当作预期rehydration。

## 阶段二：保留view

1. `WorkspaceShell`维护当前页面已访问且仍live的terminal id集合。
2. keyed each稳定渲染active或已访问pane；inactive pane使用hidden wrapper，terminal删除时自然销毁。
3. `TerminalSlot`接收active状态，只允许active host执行尺寸计算和PTY resize；activation后安排一次布局完成后的fit。
4. 增加最小wrapper CSS，不调整terminal/tab既有视觉。

## 阶段三：验证与收口

1. 覆盖long replay、hidden live output、Text scroll、delete cleanup和historical query hydration。
2. 将`.031A`历史journey原文归档为非Playwright-spec文件，以byte digest继续冻结；`test:e2e`改为发现全部current specs。
3. 执行静态检查、build、focused/browser/full task Gate与`.031B`回归。
4. 更新active room terminal spec和task review，确认没有server/protocol/Macro/Library diff。

## Legacy Kill List

* 删除`WorkspaceShell`中只渲染active terminal的单一`{#if}`和terminalId `{#key}`生命周期。
* 删除测试中“每次tab切换都会rehydration”的预期与命名。
* 删除current E2E的人工文件allowlist和历史`.031B` journey误用的`.spec.ts`入口；不删除历史内容。
* 不保留兼容分支、旧切换路径或可选feature flag。
