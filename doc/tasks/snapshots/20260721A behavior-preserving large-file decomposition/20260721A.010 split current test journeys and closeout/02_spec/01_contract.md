# Contract

## 任务边界

### Added Semantics

无产品语义；不新增测试替代既有断言。本任务只改变current test文件归属和执行组织。

### Frozen Semantics

* 四个primary文件中每个test case、用户步骤、HTTP/WS ordering gate、fixture、timeout意图和assertion冻结。
* 失败必须仍指向相同产品contract；不得用retry、sleep或宽泛selector把race隐藏。
* `.031B`中的`.031A`历史source/constants及内容digest冻结；沿用`.039`已归档为`.historical.ts`、不进入current Playwright discovery的边界，不再次移动、重命名或格式化。current evolving inventory保持`.038`已登记的199 source controls与AgentEvent专项归属。
* `just`公开test entry、browser/server隔离、HISTFILE/test data root和离线能力冻结。
* 测试总inventory和各contract coverage不得减少。
* `test:e2e`使用Playwright目录级current `*.spec.ts`自动发现，不维护会漏掉新增current spec的手写allowlist；historical source必须使用非`.spec.ts`扩展名。

### Primary files

* `tests/e2e/roomRuntimeSync035.spec.ts`
* `tests/e2e/libraryWorkbench036.spec.ts`
* `tests/e2e/macroWorkbench034.spec.ts`
* `tests/integration/macroRuntime034.test.ts`

## 任务规范

### E2E拆分

Room runtime按以下journey分文件：controller/takeover与mutation feedback、runner snapshot/delta/reconnect、runtime input/notification、saved-content invalidation races。

Library按以下journey分文件：基础scope/kind/CRUD/search、edit lease/navigation、Create/Save/Delete race与preserved buffer、Load/validation/reconnect。

Macro workbench按以下journey分文件：record/JSON session、terminal layout/Prepare/Start、visual Flow editor和readonly/pending feedback。

文件名使用既有task suffix并表达journey，例如`roomRuntimeSync035.runner.spec.ts`；最终命名可微调，但一个test只属于一个文件。

文件名和公开入口顺序不得承担fixture清理职责。每个拆分后的spec必须在独立运行时通过，也必须在前序spec遗留live Room时通过自己的显式setup/cleanup建立前置条件。

### Integration拆分

`macroRuntime034.test.ts`按runner lifecycle、Flow/Action execution、Prepare/binding、durable event fault/retention和terminal quiet/cancellation拆分。共享fixture只负责构造环境和显式fault gates，不封装被测业务断言。

### Helper边界

允许提取：稳定locator常量、server/test data root setup、显式route commit gate、重复的无业务含义输入动作。

禁止提取：隐藏完整用户journey的page object、自动重试assertion、按测试名切换行为的helper、吞掉response/console错误的wrapper。

### Parity清单

实施前为每个primary file记录：test title、关键用户steps、forced interleaving point、assertion列表和对应active spec。拆分后清单必须一一对应；新增结构测试可增加，原项不得减少。

## 示例

### 合法

将“delayed Create response + remote Delete preserves local buffer”完整移动到Library race文件，共用一个明确的`holdRouteAfterServerCommit` gate；所有操作与assertion原样保留。

### 非法

* 把四个takeover tests合并成一个循环，只断言最终toast。
* 用`waitForTimeout`替代server commit gate。
* 删除偶发失败test并称其由综合dogfood覆盖。
* 修改`.031B`以适配20260721A模块名。

## 测试

### 拆分自验证

* 拆分前后test title/inventory、forced gate与assertion parity自动或人工清单一致。
* 单文件、分组`just`入口和全套并行/串行执行均通过。
* 每个新文件可独立运行，不依赖另一spec遗留browser/server state。
* 禁止`.only`、`.skip`、silent retry与新增固定sleep。

### 20260721A整链Gate

* `just check`与`just build`零warning。
* 全部unit、integration、real PTY和browser E2E通过。
* `just test-031b`保持冻结基线；current comprehensive/offline dogfood通过。
* `.038` AgentEvent wait-limit unit/integration/E2E继续进入公开Gate，不得在拆分current journeys时遗漏。
* route/validator/state/session/editor/runner/Room/CSS focused Gates逐项通过。
* `git diff --check`、conflict scan、legacy/duplicate implementation与import cycle scan通过。

### 行为验收

审阅20260627A.039与20260721A.010最终树的公开行为差异：只允许source/test/CSS文件组织变化；其中AgentEvent exact wait-limit专项继续以20260627A.038为语义来源。任何API/schema/UI/runtime/test coverage差异均阻断Close Gate。
