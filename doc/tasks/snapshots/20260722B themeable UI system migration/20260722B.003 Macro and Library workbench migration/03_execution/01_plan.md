# Execution Plan

## 1. 冻结结构与状态matrix

* 从`20260722A.002`生成并提交全Svelte per-file non-presentation structure fixture；本任务消费其中25个Macro/Library component baseline，同时生成control、test-id与nested relation inventory。
* 记录1600/900/720关键control geometry、scroll owner和recent `.001`UI state，并冻结760/761 exact responsive结果。
* 先建立replacement current oracle，明确旧`.009`hash为何退役、什么新断言承接其回归价值。

## 2. 迁移shared chrome和Library

* 先迁移MacroWorkbenchChrome、shared buttons/forms/status primitives，但只复用existing component owner。
* 迁移Library tabs/search/list/detail/editor和lease/read-only/pending state。
* 删除对应legacy selectors并运行Library CRUD/navigation/race/reconnect journeys。

## 3. 迁移Macro authoring

* 按chrome → fields → action/control nodes → nested Flow/Parallel/For → insertion/template controls顺序迁移。
* 每个阶段核对element/control order、keyboard path、disabled state和compact geometry。
* 删除对应external rule与component `<style>`，不保留双owner。

## 4. 迁移runtime feedback

* 迁移run dock、status badge、current stage/current node、input controls和Trace。
* 在controller/observer、starting/running/paused/waiting/stopping/terminal state下验证readonly与current location足够明显。
* 回归frozen running snapshot不覆盖local draft的current行为。

## 5. 删除legacy workbench并自审

* 删除八个CSS modules、aggregator import、10个component `<style>`和`.002`交接selectors。
* 扫描new CSS搬运、hard-coded UI color、dynamic utility、exclusive `max-[760px]`、父fixture以外的DOM diff和产品source越界。
* 执行representative theme/viewport/state matrix、current Macro/Library suites、check/build/diff Gate并记录P1/P2/P3。
