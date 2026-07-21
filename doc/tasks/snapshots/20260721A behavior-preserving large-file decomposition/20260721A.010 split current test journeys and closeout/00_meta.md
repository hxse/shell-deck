# 20260721A.010 Split Current Test Journeys And Closeout

## 任务概括

把四个大型current E2E/integration文件按独立用户journey、竞态和fault domain拆开，在不改变fixture、用户操作、断言或覆盖范围的前提下提高定位与维护性。本任务同时负责20260721A.001-.009完整stack的最终行为等价验收。

## 正式 task 级别及定级原因

二星任务。

只改test organization，但测试是本轮“零行为漂移”的证据。错误拆分可能遗漏断言、改变共享fixture顺序、掩盖race或让测试绿色却不再覆盖原行为，因此必须建立case/step/assertion inventory。

## 范围内

* 拆分`roomRuntimeSync035.spec.ts`、`libraryWorkbench036.spec.ts`、`macroWorkbench034.spec.ts`和`macroRuntime034.test.ts`。
* 提取透明、低层的fixture/locator/route gate helper。
* 保留每个case的用户行为、forced ordering和断言。
* 执行所有子任务focused Gate和最终stack Gate。

## 范围外

* 不修改`.031B`冻结的`.031A`历史source/constants、内容digest或其语义；沿用`.039`已归档为`.historical.ts`且不进入current Playwright discovery的边界。current evolving inventory只能随真实后继contract做有归属的更新。
* 不删除、合并或弱化current测试场景。
* 不创建隐藏用户步骤的test DSL/page-object框架。
* 不借测试拆分修产品代码；发现问题另归原change或新task。
