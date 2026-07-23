# Problem Context

## 问题

前两轮拆分已经建立了正确的domain边界，但current tree仍有十二个production文件和四组mutable test source超过400行。它们不是同一种问题：有的是atomic persistence与codec混在一起，有的是facade继续承载多个state machine，有的是Svelte owner把navigation、message routing和render wiring放在一个文件，有的是测试证据本身仍集中在单一大文件。

当前基线中，主要production文件为：

* `evidenceStore.ts` 565行、`macroRunnerService.ts` 587行、`contentEditLeaseService.ts` 467行；
* `roomControlCoordinator.ts` 453行、`terminalBackendCoordinator.ts` 444行、`terminalRoomManager.ts` 485行；
* `roomWorkspaceState.svelte.ts` 461行、Macro/Library session 691/766行；
* `macroNodeValidation.ts` 445行、Parallel controller 423行、`MacroFlowNodeList.svelte` 431行。

mutable test中，current Macro comprehensive journey为940行、control inventory为580行、Macro definition unit为510行，两个Room E2E文件为438/431行。1041行的`.031B` historical journey已经退出current Playwright discovery，仅由unit test校验raw-byte SHA-256；jj历史本身可以恢复这份旧源码，当前仓库不再为它保留永久大文件或file-size豁免。与其独立的control inventory baseline继续作为结构化历史证据。

## 为什么不追加到20260723B

`20260723B`的范围是四个明确coordinator ownership，并已完成Close Gate。本轮新增了evidence persistence、runner、workspace、validation和test infrastructure。追加`.005`会把已完成历史边界改写成开放任务，也会让root review无法准确表达当时实际交付。

因此使用新的`20260723C`，父change精确为`20260723B.004`。新root只描述本轮机械拆分，不回改旧task正文。

## 方案取舍

可选方案有三种：

1. 只按行数任意切文件。实现快，但容易制造generic helper、反向依赖和重复state。
2. 再次进行大规模架构重做。可能得到更小文件，但会越过behavior-preserving边界。
3. 沿当前已存在的transaction、coordinator、session和component seam逐child拆分，并用400行Gate收口。

采用第三种。400行是完成条件，不是允许破坏ownership的理由；若某个边界只能通过复制state、改变await顺序或削弱测试才能达到，当前child必须停在Document/Execution Gate重新审边界。

## 本轮文档阶段

用户要求先预建完整串行change stack并写文档，因此本轮会建立所有child的文档change，但不进入任何实现。以后仍必须从`.001`开始依次`jj edit`；一个child的focused Gate通过后才进入下一个。早期change修改导致后继文档change自动rebase时，任何冲突都必须停止并回滚本次操作，不能用`jj resolve`猜测。
